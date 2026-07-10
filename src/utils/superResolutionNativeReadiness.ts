export interface SuperResolutionNativeReadinessSource {
  blockCodes: string[];
  cameraMake: string;
  cameraModel: string;
  path: string;
  sourceIndex: number;
}

export interface SuperResolutionNativeReadiness {
  accepted: boolean;
  blockCodes: string[];
  sourceCount: number;
  sources: SuperResolutionNativeReadinessSource[];
  warningCodes: string[];
}
