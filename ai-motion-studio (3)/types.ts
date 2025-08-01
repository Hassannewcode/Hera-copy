
export type AspectRatio = '16:9' | '9:16' | '1:1';

export type ShapeType = 'rectangle' | 'circle';

export interface AnimationKeyframe {
  at: number; // Percentage of scene duration (0 to 1)
  style: React.CSSProperties;
}

export interface AnimationElement {
  id: string;
  type: 'shape' | 'text';
  shape?: ShapeType;
  text?: string;
  keyframes: AnimationKeyframe[];
}

export interface Scene {
  animationElements: AnimationElement[];
  cameraAnimation?: AnimationKeyframe[];
  imageUrl?: string;
  backgroundColor?: string;
}

export interface VideoResult {
  scenes: Scene[];
  narration?: string[];
  aspectRatio: AspectRatio;
  textColor: string;
  transparentBackground: boolean;
  backgroundColor?: string;
}

export interface LoadingState {
  step: number;
  totalSteps: number;
  message: string;
}