# Thumbnail resource transport

Thumbnail events publish a `ThumbnailResourceDescriptor`; they never contain JPEG bytes or data URLs. The frontend gives the revisioned `rapidraw-thumb` URL directly to the browser image loader. `get_thumbnail_resource` is the raw-byte fallback and creates a browser-owned object URL without base64 conversion.

## Platform behavior

Tauri 2.11 maps registered custom protocols as follows. The frontend URL builder follows the same mapping.

| Platform | Resource URL origin | Transport |
| --- | --- | --- |
| macOS | `rapidraw-thumb://localhost` | WebKit custom scheme |
| Windows | `http://rapidraw-thumb.localhost` | WebView2 web-resource handler |
| Linux | `rapidraw-thumb://localhost` | WebKitGTK URI scheme |
| Android | `http://rapidraw-thumb.localhost` | Android WebView custom protocol |
| iOS | `rapidraw-thumb://localhost` | WebKit custom scheme |

All platforms use the same descriptor and strict resource resolver. Unsupported/custom WebView integrations may invoke the binary fallback. The keyed frontend cache owns fallback object URL replacement and revocation.

## Runtime evidence

Measured 2026-07-11 from 260 existing RapidRAW cache JPEGs: 11,013,455 total bytes, 42,359-byte mean (4,039 minimum, 120,598 maximum). The comparison uses a conservative 41,634-byte representative JPEG and JSON-serializes the production descriptor event shape.

| Warm cached thumbnails | Legacy base64 event bytes | Descriptor event bytes | Reduction | JPEG bytes read before image request |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 55,535,000 | 326,000 | 99.41% | 41,634,000 -> 0 |
| 10,000 | 555,350,000 | 3,260,000 | 99.41% | 416,340,000 -> 0 |

The new cache-hit path reads the small resource manifest and filesystem metadata only. JPEG body bytes are read by the resource handler after browser image demand. `get_thumbnail_transport_metrics` reports protocol requests, bytes served, errors, fallback calls, and the migrated thumbnail base64 call count (always zero).
