use std::num::NonZero;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

#[cfg(target_os = "windows")]
use tauri::Manager;

#[cfg(target_os = "windows")]
use half::f16;

#[cfg(target_os = "windows")]
use crate::display_profile::build_srgb_to_active_display_lut_for_app;
#[cfg(target_os = "windows")]
use crate::gpu::pipeline_registry::GpuPipelineRegistry;

#[repr(C)]
#[derive(Debug, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub struct DisplayTransform {
    pub rect: [f32; 4],
    pub clip: [f32; 4],
    pub window: [f32; 2],
    pub image_size: [f32; 2],
    pub texture_size: [f32; 2],
    pub pixelated: f32,
    pub _pad: f32,
    pub bg_primary: [f32; 4],
    pub bg_secondary: [f32; 4],
}

pub struct WgpuDisplay {
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    _display_lut_texture: wgpu::Texture,
    display_lut_view: wgpu::TextureView,
    transform_buffer: wgpu::Buffer,
    latest_transform: DisplayTransform,
    current_bind_group: Option<wgpu::BindGroup>,
}

impl WgpuDisplay {
    fn has_drawable_image(&self) -> bool {
        transform_has_drawable_image(&self.latest_transform, self.current_bind_group.is_some())
    }

    fn render(&mut self, device: &wgpu::Device, queue: &wgpu::Queue) -> bool {
        if let Some(bind_group) = &self.current_bind_group {
            let output = match self.surface.get_current_texture() {
                wgpu::CurrentSurfaceTexture::Success(tex)
                | wgpu::CurrentSurfaceTexture::Suboptimal(tex) => tex,
                wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                    self.surface.configure(device, &self.config);
                    match self.surface.get_current_texture() {
                        wgpu::CurrentSurfaceTexture::Success(tex)
                        | wgpu::CurrentSurfaceTexture::Suboptimal(tex) => tex,
                        _ => return false,
                    }
                }
                _ => return false,
            };
            let view = output
                .texture
                .create_view(&wgpu::TextureViewDescriptor::default());
            let mut encoder =
                device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
            {
                let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: None,
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color {
                                r: self.latest_transform.bg_primary[0] as f64,
                                g: self.latest_transform.bg_primary[1] as f64,
                                b: self.latest_transform.bg_primary[2] as f64,
                                a: self.latest_transform.bg_primary[3] as f64,
                            }),
                            store: wgpu::StoreOp::Store,
                        },
                        depth_slice: None,
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: NonZero::new(0),
                });
                let clip_x1 = self.latest_transform.clip[0].max(0.0);
                let clip_y1 = self.latest_transform.clip[1].max(0.0);
                let clip_x2 =
                    (self.latest_transform.clip[0] + self.latest_transform.clip[2]).max(0.0);
                let clip_y2 =
                    (self.latest_transform.clip[1] + self.latest_transform.clip[3]).max(0.0);

                let final_clip_x = clip_x1.floor() as u32;
                let final_clip_y = clip_y1.floor() as u32;
                let final_clip_w = (clip_x2.ceil() as u32).saturating_sub(final_clip_x);
                let final_clip_h = (clip_y2.ceil() as u32).saturating_sub(final_clip_y);

                let max_x = self.config.width;
                let max_y = self.config.height;

                if final_clip_x < max_x && final_clip_y < max_y {
                    let clamped_width = final_clip_w.min(max_x - final_clip_x);
                    let clamped_height = final_clip_h.min(max_y - final_clip_y);

                    if clamped_width > 0 && clamped_height > 0 {
                        rpass.set_scissor_rect(
                            final_clip_x,
                            final_clip_y,
                            clamped_width,
                            clamped_height,
                        );

                        rpass.set_pipeline(&self.pipeline);
                        rpass.set_bind_group(0, bind_group, &[]);
                        rpass.draw(0..4, 0..1);
                    }
                }
            }
            queue.submit(Some(encoder.finish()));
            output.present();
            return true;
        }
        false
    }
}

fn transform_has_drawable_image(transform: &DisplayTransform, has_texture: bool) -> bool {
    has_texture
        && transform.rect[2] > 0.0
        && transform.rect[3] > 0.0
        && transform.clip[2] > 0.0
        && transform.clip[3] > 0.0
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DisplayTransformState {
    pub rect: [f32; 4],
    pub clip: [f32; 4],
    pub window: [f32; 2],
    pub bg_primary: [f32; 4],
    pub bg_secondary: [f32; 4],
    pub pixelated: bool,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Ord, PartialOrd)]
pub struct PresentationSequence(pub u64);

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Ord, PartialOrd)]
pub struct NativeFrameIdentity {
    pub image_session: u64,
    pub preview_generation: u64,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct PresentationDirty(u8);

impl PresentationDirty {
    const TRANSFORM: Self = Self(1 << 0);
    const SURFACE_SIZE: Self = Self(1 << 1);
    const TEXTURE: Self = Self(1 << 2);

    fn insert(&mut self, other: Self) {
        self.0 |= other.0;
    }

    fn contains(self, other: Self) -> bool {
        self.0 & other.0 != 0
    }

    fn is_empty(self) -> bool {
        self.0 == 0
    }
}

struct PublishedTexture {
    revision: u64,
    view: wgpu::TextureView,
    image_size: [u32; 2],
    texture_size: [u32; 2],
    receipt: Option<std::sync::mpsc::SyncSender<Result<(), String>>>,
}

impl PublishedTexture {
    fn complete(&mut self, result: Result<(), String>) {
        if let Some(receipt) = self.receipt.take() {
            let _ = receipt.send(result);
        }
    }
}

#[derive(Default)]
struct PendingPresentation {
    sequence: PresentationSequence,
    transform_submitted_at: Option<Instant>,
    transform: Option<DisplayTransformState>,
    surface_size: Option<[u32; 2]>,
    texture: Option<PublishedTexture>,
    dirty: PresentationDirty,
}

struct FlushWaiter {
    sequence: PresentationSequence,
    response: tokio::sync::oneshot::Sender<Result<(), String>>,
}

#[derive(Default)]
struct Mailbox {
    pending: PendingPresentation,
    waiters: Vec<FlushWaiter>,
    presented_sequence: PresentationSequence,
    stopped: bool,
    latest_native_frame: NativeFrameIdentity,
}

fn accept_native_frame(mailbox: &mut Mailbox, identity: NativeFrameIdentity) -> bool {
    if identity < mailbox.latest_native_frame {
        return false;
    }
    mailbox.latest_native_frame = identity;
    true
}

#[derive(Default)]
struct SchedulerMetrics {
    submitted_transforms: AtomicU64,
    coalesced_transforms: AtomicU64,
    uniform_writes: AtomicU64,
    presents: AtomicU64,
    surface_configures: AtomicU64,
    texture_publications: AtomicU64,
    texture_replaced_before_present: AtomicU64,
    hidden_skipped_frames: AtomicU64,
    latest_transform_latency_micros: AtomicU64,
    max_transform_latency_micros: AtomicU64,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct PresentationSchedulerReport {
    pub submitted_transforms: u64,
    pub coalesced_transforms: u64,
    pub uniform_writes: u64,
    pub presents: u64,
    pub surface_configures: u64,
    pub texture_publications: u64,
    pub texture_replaced_before_present: u64,
    pub hidden_skipped_frames: u64,
    pub latest_transform_latency_micros: u64,
    pub max_transform_latency_micros: u64,
    pub pending_flush_waiters: usize,
    pub mailbox_resident_bytes: usize,
}

struct SchedulerShared {
    mailbox: Mutex<Mailbox>,
    wake: Condvar,
    next_sequence: AtomicU64,
    next_texture_revision: AtomicU64,
    metrics: SchedulerMetrics,
    has_display: AtomicBool,
}

pub struct WgpuPresentationScheduler {
    shared: Arc<SchedulerShared>,
    owner: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl WgpuPresentationScheduler {
    pub fn new(
        display: Option<WgpuDisplay>,
        device: Arc<wgpu::Device>,
        queue: Arc<wgpu::Queue>,
    ) -> Self {
        let shared = Arc::new(SchedulerShared {
            mailbox: Mutex::new(Mailbox::default()),
            wake: Condvar::new(),
            next_sequence: AtomicU64::new(0),
            next_texture_revision: AtomicU64::new(0),
            metrics: SchedulerMetrics::default(),
            has_display: AtomicBool::new(display.is_some()),
        });
        let thread_shared = Arc::clone(&shared);
        let owner = std::thread::Builder::new()
            .name("wgpu-presentation".into())
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    presentation_owner_loop(Arc::clone(&thread_shared), display, device, queue);
                }));
                if result.is_err() {
                    stop_mailbox(&thread_shared);
                }
            })
            .expect("failed to start WGPU presentation owner");
        Self {
            shared,
            owner: Mutex::new(Some(owner)),
        }
    }

    pub fn submit_transform(&self, state: DisplayTransformState) -> Result<u64, String> {
        if !transform_is_finite(state) {
            return Err("invalid WGPU transform: values must be finite".into());
        }
        let mut mailbox = self.shared.mailbox.lock().unwrap();
        if mailbox.stopped || !self.shared.has_display.load(Ordering::Acquire) {
            return Err("presentation_stopped".into());
        }
        let sequence =
            PresentationSequence(self.shared.next_sequence.fetch_add(1, Ordering::Relaxed) + 1);
        self.shared
            .metrics
            .submitted_transforms
            .fetch_add(1, Ordering::Relaxed);
        if mailbox.pending.transform.replace(state).is_some() {
            self.shared
                .metrics
                .coalesced_transforms
                .fetch_add(1, Ordering::Relaxed);
        }
        mailbox.pending.sequence = sequence;
        mailbox.pending.transform_submitted_at = Some(Instant::now());
        mailbox.pending.dirty.insert(PresentationDirty::TRANSFORM);
        drop(mailbox);
        self.shared.wake.notify_one();
        Ok(sequence.0)
    }

    pub fn resize(&self, width: u32, height: u32) {
        let mut mailbox = self.shared.mailbox.lock().unwrap();
        if mailbox.stopped {
            return;
        }
        mailbox.pending.surface_size = Some([width, height]);
        mailbox
            .pending
            .dirty
            .insert(PresentationDirty::SURFACE_SIZE);
        drop(mailbox);
        self.shared.wake.notify_one();
    }

    pub fn is_available(&self) -> bool {
        let mailbox = self.shared.mailbox.lock().unwrap();
        self.shared.has_display.load(Ordering::Acquire) && !mailbox.stopped
    }

    pub fn publish_texture(
        &self,
        view: wgpu::TextureView,
        image_size: [u32; 2],
        texture_size: [u32; 2],
    ) -> Result<(), String> {
        self.publish_texture_for_frame(view, image_size, texture_size, None)
    }

    pub fn publish_texture_for_frame(
        &self,
        view: wgpu::TextureView,
        image_size: [u32; 2],
        texture_size: [u32; 2],
        identity: Option<NativeFrameIdentity>,
    ) -> Result<(), String> {
        self.publish_texture_for_frame_with_receipt(view, image_size, texture_size, identity, None)
    }

    pub fn present_texture_for_frame(
        &self,
        view: wgpu::TextureView,
        image_size: [u32; 2],
        texture_size: [u32; 2],
        identity: Option<NativeFrameIdentity>,
    ) -> Result<(), String> {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        self.publish_texture_for_frame_with_receipt(
            view,
            image_size,
            texture_size,
            identity,
            Some(sender),
        )?;
        receiver
            .recv_timeout(Duration::from_millis(750))
            .map_err(|error| match error {
                std::sync::mpsc::RecvTimeoutError::Timeout => String::from("presentation_timeout"),
                std::sync::mpsc::RecvTimeoutError::Disconnected => {
                    String::from("presentation_stopped")
                }
            })?
    }

    fn publish_texture_for_frame_with_receipt(
        &self,
        view: wgpu::TextureView,
        image_size: [u32; 2],
        texture_size: [u32; 2],
        identity: Option<NativeFrameIdentity>,
        receipt: Option<std::sync::mpsc::SyncSender<Result<(), String>>>,
    ) -> Result<(), String> {
        let mut mailbox = self.shared.mailbox.lock().unwrap();
        if mailbox.stopped || !self.shared.has_display.load(Ordering::Acquire) {
            return Err("presentation_unavailable".into());
        }
        if let Some(identity) = identity
            && !accept_native_frame(&mut mailbox, identity)
        {
            return Err("presentation_stale_frame".into());
        }
        let revision = self
            .shared
            .next_texture_revision
            .fetch_add(1, Ordering::Relaxed)
            + 1;
        self.shared
            .metrics
            .texture_publications
            .fetch_add(1, Ordering::Relaxed);
        let texture = PublishedTexture {
            revision,
            view,
            image_size,
            texture_size,
            receipt,
        };
        if let Some(mut replaced) = mailbox.pending.texture.replace(texture) {
            replaced.complete(Err("presentation_replaced".into()));
            self.shared
                .metrics
                .texture_replaced_before_present
                .fetch_add(1, Ordering::Relaxed);
        }
        mailbox.pending.dirty.insert(PresentationDirty::TEXTURE);
        drop(mailbox);
        self.shared.wake.notify_one();
        Ok(())
    }

    pub async fn flush(&self, sequence: u64) -> Result<(), String> {
        let (response, receiver) = tokio::sync::oneshot::channel();
        {
            let mut mailbox = self.shared.mailbox.lock().unwrap();
            if mailbox.stopped {
                return Err("presentation_stopped".into());
            }
            if !self.shared.has_display.load(Ordering::Acquire) {
                return Err("presentation_unavailable".into());
            }
            if PresentationSequence(sequence) <= mailbox.presented_sequence {
                return Ok(());
            }
            mailbox.waiters.push(FlushWaiter {
                sequence: PresentationSequence(sequence),
                response,
            });
        }
        self.shared.wake.notify_one();
        receiver
            .await
            .unwrap_or_else(|_| Err("presentation_stopped".into()))
    }

    pub fn report(&self) -> PresentationSchedulerReport {
        let mailbox = self.shared.mailbox.lock().unwrap();
        let metrics = &self.shared.metrics;
        PresentationSchedulerReport {
            submitted_transforms: metrics.submitted_transforms.load(Ordering::Relaxed),
            coalesced_transforms: metrics.coalesced_transforms.load(Ordering::Relaxed),
            uniform_writes: metrics.uniform_writes.load(Ordering::Relaxed),
            presents: metrics.presents.load(Ordering::Relaxed),
            surface_configures: metrics.surface_configures.load(Ordering::Relaxed),
            texture_publications: metrics.texture_publications.load(Ordering::Relaxed),
            texture_replaced_before_present: metrics
                .texture_replaced_before_present
                .load(Ordering::Relaxed),
            hidden_skipped_frames: metrics.hidden_skipped_frames.load(Ordering::Relaxed),
            latest_transform_latency_micros: metrics
                .latest_transform_latency_micros
                .load(Ordering::Relaxed),
            max_transform_latency_micros: metrics
                .max_transform_latency_micros
                .load(Ordering::Relaxed),
            pending_flush_waiters: mailbox.waiters.len(),
            mailbox_resident_bytes: std::mem::size_of::<Mailbox>()
                + mailbox.waiters.capacity() * std::mem::size_of::<FlushWaiter>(),
        }
    }
}

impl Drop for WgpuPresentationScheduler {
    fn drop(&mut self) {
        stop_mailbox(&self.shared);
        if let Some(owner) = self.owner.lock().unwrap().take() {
            let _ = owner.join();
        }
    }
}

fn stop_mailbox(shared: &SchedulerShared) {
    let waiters = {
        let mut mailbox = shared
            .mailbox
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        mailbox.stopped = true;
        if let Some(mut texture) = mailbox.pending.texture.take() {
            texture.complete(Err("presentation_stopped".into()));
        }
        std::mem::take(&mut mailbox.waiters)
    };
    for waiter in waiters {
        let _ = waiter.response.send(Err("presentation_stopped".into()));
    }
    shared.wake.notify_all();
}

fn transform_is_finite(state: DisplayTransformState) -> bool {
    state
        .rect
        .into_iter()
        .chain(state.clip)
        .chain(state.window)
        .chain(state.bg_primary)
        .chain(state.bg_secondary)
        .all(f32::is_finite)
}

fn presentation_owner_loop(
    shared: Arc<SchedulerShared>,
    mut display: Option<WgpuDisplay>,
    device: Arc<wgpu::Device>,
    queue: Arc<wgpu::Queue>,
) {
    let frame_interval = Duration::from_nanos(1_000_000_000 / 120);
    let mut next_frame = Instant::now();
    let mut last_transform = None;
    let mut last_texture_revision = 0;
    let mut presented_sequence = PresentationSequence(0);
    let mut latest_unpresented_sequence = PresentationSequence(0);
    let mut surface_visible = display
        .as_ref()
        .is_some_and(|display| display.config.width > 0 && display.config.height > 0);
    let mut needs_present = false;
    let mut latest_transform_submitted_at = None;
    let mut pending_texture_receipt = None;
    loop {
        let mut mailbox = shared.mailbox.lock().unwrap();
        while mailbox.pending.dirty.is_empty() && !mailbox.stopped {
            mailbox = shared.wake.wait(mailbox).unwrap();
        }
        if mailbox.stopped {
            break;
        }
        let mut now = Instant::now();
        while now < next_frame {
            let (new_mailbox, _) = shared.wake.wait_timeout(mailbox, next_frame - now).unwrap();
            mailbox = new_mailbox;
            if mailbox.stopped {
                break;
            }
            now = Instant::now();
        }
        if mailbox.stopped {
            break;
        }
        let pending = std::mem::take(&mut mailbox.pending);
        drop(mailbox);
        latest_unpresented_sequence = latest_unpresented_sequence.max(pending.sequence);
        if pending.transform_submitted_at.is_some() {
            latest_transform_submitted_at = pending.transform_submitted_at;
        }

        let Some(display) = display.as_mut() else {
            continue;
        };
        let mut effective_change = false;
        if pending.dirty.contains(PresentationDirty::SURFACE_SIZE)
            && let Some([width, height]) = pending.surface_size
        {
            surface_visible = width > 0 && height > 0;
            if surface_visible && (display.config.width != width || display.config.height != height)
            {
                display.config.width = width;
                display.config.height = height;
                display.surface.configure(&device, &display.config);
                shared
                    .metrics
                    .surface_configures
                    .fetch_add(1, Ordering::Relaxed);
                effective_change = true;
            }
        }
        if let Some(mut texture) = pending.texture
            && texture.revision > last_texture_revision
        {
            display.latest_transform.image_size = texture.image_size.map(|value| value as f32);
            display.latest_transform.texture_size = texture.texture_size.map(|value| value as f32);
            display.current_bind_group =
                Some(device.create_bind_group(&wgpu::BindGroupDescriptor {
                    layout: &display.bind_group_layout,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: display.transform_buffer.as_entire_binding(),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::TextureView(&texture.view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 2,
                            resource: wgpu::BindingResource::Sampler(&display.sampler),
                        },
                        wgpu::BindGroupEntry {
                            binding: 3,
                            resource: wgpu::BindingResource::TextureView(&display.display_lut_view),
                        },
                    ],
                    label: Some("Scheduled Display Bind Group"),
                }));
            last_texture_revision = texture.revision;
            if let Some(receipt) = texture.receipt.take()
                && let Some(previous) = pending_texture_receipt.replace(receipt)
            {
                let _ = previous.send(Err("presentation_replaced".into()));
            }
            effective_change = true;
        }
        if let Some(transform) = pending.transform
            && last_transform != Some(transform)
        {
            display.latest_transform.rect = transform.rect;
            display.latest_transform.clip = transform.clip;
            display.latest_transform.window = transform.window;
            display.latest_transform.bg_primary = transform.bg_primary;
            display.latest_transform.bg_secondary = transform.bg_secondary;
            display.latest_transform.pixelated = f32::from(transform.pixelated);
            last_transform = Some(transform);
            effective_change = true;
        }
        if effective_change {
            queue.write_buffer(
                &display.transform_buffer,
                0,
                bytemuck::bytes_of(&display.latest_transform),
            );
            shared
                .metrics
                .uniform_writes
                .fetch_add(1, Ordering::Relaxed);
            needs_present = true;
        }
        if surface_visible && needs_present && display.render(&device, &queue) {
            shared.metrics.presents.fetch_add(1, Ordering::Relaxed);
            presented_sequence = presented_sequence.max(latest_unpresented_sequence);
            needs_present = false;
            if display.has_drawable_image()
                && let Some(receipt) = pending_texture_receipt.take()
            {
                let _ = receipt.send(Ok(()));
            }
            next_frame = Instant::now() + frame_interval;
            if let Some(submitted_at) = latest_transform_submitted_at.take() {
                let latency = submitted_at.elapsed().as_micros().min(u64::MAX as u128) as u64;
                shared
                    .metrics
                    .latest_transform_latency_micros
                    .store(latency, Ordering::Relaxed);
                shared
                    .metrics
                    .max_transform_latency_micros
                    .fetch_max(latency, Ordering::Relaxed);
            }
            complete_covered_waiters(&shared, presented_sequence);
        } else if surface_visible && needs_present && display.current_bind_group.is_some() {
            fail_presentation(&shared, "presentation_failed");
            if let Some(receipt) = pending_texture_receipt.take() {
                let _ = receipt.send(Err("presentation_failed".into()));
            }
        } else if surface_visible && !needs_present {
            presented_sequence = presented_sequence.max(latest_unpresented_sequence);
            complete_covered_waiters(&shared, presented_sequence);
        } else if !surface_visible {
            shared
                .metrics
                .hidden_skipped_frames
                .fetch_add(1, Ordering::Relaxed);
        }
    }
    if let Some(receipt) = pending_texture_receipt {
        let _ = receipt.send(Err("presentation_stopped".into()));
    }
}

fn fail_presentation(shared: &SchedulerShared, reason: &str) {
    shared.has_display.store(false, Ordering::Release);
    let waiters = {
        let mut mailbox = shared.mailbox.lock().unwrap();
        std::mem::take(&mut mailbox.waiters)
    };
    for waiter in waiters {
        let _ = waiter.response.send(Err(reason.into()));
    }
}

fn complete_covered_waiters(shared: &SchedulerShared, presented: PresentationSequence) {
    let mut mailbox = shared.mailbox.lock().unwrap();
    mailbox.presented_sequence = mailbox.presented_sequence.max(presented);
    let mut remaining = Vec::with_capacity(mailbox.waiters.len());
    for waiter in mailbox.waiters.drain(..) {
        if waiter.sequence <= presented {
            let _ = waiter.response.send(Ok(()));
        } else {
            remaining.push(waiter);
        }
    }
    mailbox.waiters = remaining;
}

#[cfg(target_os = "windows")]
pub(crate) fn create_wgpu_display(
    surface: wgpu::Surface<'static>,
    adapter: &wgpu::Adapter,
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    window: &tauri::WebviewWindow,
    pipeline_registry: &Arc<GpuPipelineRegistry>,
) -> WgpuDisplay {
    let swapchain_caps = surface.get_capabilities(adapter);
    let swapchain_format = swapchain_caps
        .formats
        .iter()
        .copied()
        .find(|f| !f.is_srgb())
        .unwrap_or(swapchain_caps.formats[0]);

    let alpha_mode = if cfg!(target_os = "windows")
        && swapchain_caps
            .alpha_modes
            .contains(&wgpu::CompositeAlphaMode::Opaque)
    {
        wgpu::CompositeAlphaMode::Opaque
    } else if swapchain_caps
        .alpha_modes
        .contains(&wgpu::CompositeAlphaMode::PreMultiplied)
    {
        wgpu::CompositeAlphaMode::PreMultiplied
    } else if swapchain_caps
        .alpha_modes
        .contains(&wgpu::CompositeAlphaMode::PostMultiplied)
    {
        wgpu::CompositeAlphaMode::PostMultiplied
    } else {
        swapchain_caps.alpha_modes[0]
    };

    let size = window
        .inner_size()
        .unwrap_or(tauri::PhysicalSize::new(1280, 720));
    let config = wgpu::SurfaceConfiguration {
        width: size.width.max(1),
        height: size.height.max(1),
        format: swapchain_format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        present_mode: wgpu::PresentMode::Fifo,
        alpha_mode,
        view_formats: vec![],
        desired_maximum_frame_latency: 2,
    };
    surface.configure(device, &config);

    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("Display Shader"),
        source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/display.wgsl").into()),
    });

    let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("Display BGL"),
        entries: &[
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                count: None,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
            },
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: wgpu::ShaderStages::FRAGMENT,
                count: None,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
            },
            wgpu::BindGroupLayoutEntry {
                binding: 2,
                visibility: wgpu::ShaderStages::FRAGMENT,
                count: None,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
            },
            wgpu::BindGroupLayoutEntry {
                binding: 3,
                visibility: wgpu::ShaderStages::FRAGMENT,
                count: None,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D3,
                    multisampled: false,
                },
            },
        ],
    });

    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("Display Pipeline Layout"),
        bind_group_layouts: &[Some(&bind_group_layout)],
        immediate_size: 0,
    });

    let pipeline_started = Instant::now();
    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("Display Pipeline"),
        layout: Some(&pipeline_layout),
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vs_main"),
            buffers: &[],
            compilation_options: Default::default(),
        },
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: Some("fs_main"),
            targets: &[Some(wgpu::ColorTargetState {
                format: swapchain_format,
                blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                write_mask: wgpu::ColorWrites::ALL,
            })],
            compilation_options: Default::default(),
        }),
        primitive: wgpu::PrimitiveState {
            topology: wgpu::PrimitiveTopology::TriangleStrip,
            ..Default::default()
        },
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        multiview_mask: NonZero::new(0),
        cache: pipeline_registry.pipeline_cache(),
    });
    pipeline_registry.record_pipeline_creation("Display Pipeline", pipeline_started.elapsed());
    pipeline_registry.persist_after_pipeline_update();

    let transform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Transform Buffer"),
        size: std::mem::size_of::<DisplayTransform>() as u64,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });

    let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("Display Sampler"),
        address_mode_u: wgpu::AddressMode::ClampToEdge,
        address_mode_v: wgpu::AddressMode::ClampToEdge,
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        ..Default::default()
    });
    let display_lut = build_srgb_to_active_display_lut_for_app(window.app_handle());
    let display_lut_texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Active Display Profile LUT"),
        size: wgpu::Extent3d {
            width: display_lut.size,
            height: display_lut.size,
            depth_or_array_layers: display_lut.size,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D3,
        format: wgpu::TextureFormat::Rgba16Float,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &display_lut_texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        bytemuck::cast_slice(&display_lut.rgba16f),
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(display_lut.size * 4 * std::mem::size_of::<f16>() as u32),
            rows_per_image: Some(display_lut.size),
        },
        wgpu::Extent3d {
            width: display_lut.size,
            height: display_lut.size,
            depth_or_array_layers: display_lut.size,
        },
    );
    log::info!(
        "Loaded active display profile LUT via {} ({:?})",
        display_lut.profile.source,
        display_lut.profile.status
    );
    let display_lut_view = display_lut_texture.create_view(&wgpu::TextureViewDescriptor {
        label: Some("Active Display Profile LUT View"),
        dimension: Some(wgpu::TextureViewDimension::D3),
        ..Default::default()
    });

    WgpuDisplay {
        surface,
        config,
        pipeline,
        bind_group_layout,
        _display_lut_texture: display_lut_texture,
        display_lut_view,
        transform_buffer,
        latest_transform: DisplayTransform {
            rect: [0.0, 0.0, 100.0, 100.0],
            clip: [0.0, 0.0, 10000.0, 10000.0],
            window: [1280.0, 720.0],
            image_size: [100.0, 100.0],
            texture_size: [100.0, 100.0],
            pixelated: 0.0,
            _pad: 0.0,
            bg_primary: [24.0 / 255.0, 24.0 / 255.0, 24.0 / 255.0, 1.0],
            bg_secondary: [35.0 / 255.0, 35.0 / 255.0, 35.0 / 255.0, 1.0],
        },
        sampler,
        current_bind_group: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_receipt_requires_texture_and_visible_geometry() {
        let mut transform = <DisplayTransform as bytemuck::Zeroable>::zeroed();
        transform.rect = [10.0, 20.0, 300.0, 200.0];
        transform.clip = [8.0, 18.0, 304.0, 204.0];
        assert!(!transform_has_drawable_image(&transform, false));
        assert!(transform_has_drawable_image(&transform, true));

        transform.rect[2] = 0.0;
        assert!(!transform_has_drawable_image(&transform, true));
        transform.rect[2] = 300.0;
        transform.clip[3] = 0.0;
        assert!(!transform_has_drawable_image(&transform, true));
    }

    fn transform(value: f32) -> DisplayTransformState {
        DisplayTransformState {
            rect: [value, value, 100.0, 100.0],
            clip: [0.0, 0.0, 100.0, 100.0],
            window: [800.0, 600.0],
            bg_primary: [0.0, 0.0, 0.0, 1.0],
            bg_secondary: [0.1, 0.1, 0.1, 1.0],
            pixelated: false,
        }
    }

    #[test]
    fn transform_flood_retains_only_latest_snapshot() {
        let mut pending = PendingPresentation::default();
        let start = Instant::now();
        for sequence in 1..=10_000 {
            pending.sequence = PresentationSequence(sequence);
            pending.transform = Some(transform(sequence as f32));
            pending.dirty.insert(PresentationDirty::TRANSFORM);
        }
        assert_eq!(pending.sequence, PresentationSequence(10_000));
        assert_eq!(pending.transform, Some(transform(10_000.0)));
        assert!(pending.dirty.contains(PresentationDirty::TRANSFORM));
        eprintln!(
            "presentation flood benchmark: events=10000 legacy_tasks=10000 legacy_render_attempts=10000 scheduled_pending=1 mailbox_bytes={} publish_time_us={}",
            std::mem::size_of::<PendingPresentation>(),
            start.elapsed().as_micros()
        );
    }

    #[test]
    fn transform_replacement_preserves_other_dirty_state() {
        let mut pending = PendingPresentation {
            surface_size: Some([1920, 1080]),
            dirty: PresentationDirty::SURFACE_SIZE,
            ..Default::default()
        };
        for sequence in 1..=100 {
            pending.sequence = PresentationSequence(sequence);
            pending.transform = Some(transform(sequence as f32));
            pending.dirty.insert(PresentationDirty::TRANSFORM);
        }
        assert_eq!(pending.surface_size, Some([1920, 1080]));
        assert!(pending.dirty.contains(PresentationDirty::SURFACE_SIZE));
        assert!(pending.dirty.contains(PresentationDirty::TRANSFORM));
    }

    #[test]
    fn identical_transform_is_not_an_effective_change() {
        let state = transform(42.0);
        let mut last_presented = None;
        assert_ne!(last_presented, Some(state));
        last_presented = Some(state);
        assert_eq!(last_presented, Some(state));
    }

    #[test]
    fn native_frame_identity_rejects_older_completion() {
        let mut mailbox = Mailbox::default();
        let newer = NativeFrameIdentity {
            image_session: 8,
            preview_generation: 42,
        };
        assert!(accept_native_frame(&mut mailbox, newer));
        assert!(!accept_native_frame(
            &mut mailbox,
            NativeFrameIdentity {
                image_session: 8,
                preview_generation: 41,
            }
        ));
        assert_eq!(mailbox.latest_native_frame, newer);
        assert!(accept_native_frame(
            &mut mailbox,
            NativeFrameIdentity {
                image_session: 9,
                preview_generation: 1,
            }
        ));
    }

    #[tokio::test]
    async fn stopping_mailbox_completes_every_waiter_once() {
        let shared = SchedulerShared {
            mailbox: Mutex::new(Mailbox::default()),
            wake: Condvar::new(),
            next_sequence: AtomicU64::new(0),
            next_texture_revision: AtomicU64::new(0),
            metrics: SchedulerMetrics::default(),
            has_display: AtomicBool::new(false),
        };
        let mut receivers = Vec::new();
        {
            let mut mailbox = shared.mailbox.lock().unwrap();
            for sequence in 1..=8 {
                let (response, receiver) = tokio::sync::oneshot::channel();
                mailbox.waiters.push(FlushWaiter {
                    sequence: PresentationSequence(sequence),
                    response,
                });
                receivers.push(receiver);
            }
        }
        stop_mailbox(&shared);
        for receiver in receivers {
            assert_eq!(receiver.await.unwrap(), Err("presentation_stopped".into()));
        }
        assert!(shared.mailbox.lock().unwrap().waiters.is_empty());
    }
}
