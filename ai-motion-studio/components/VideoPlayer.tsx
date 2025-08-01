import React, { useMemo } from 'react';
import { Player } from '@remotion/player';
import { AbsoluteFill, Img, Sequence, useCurrentFrame, useVideoConfig, interpolate, interpolateColors } from 'remotion';
import type { Scene, AspectRatio, VideoResult, AnimationElement, AnimationKeyframe } from '../types';

// A specific list of CSS properties that the AI is allowed to animate.
// This prevents TypeScript from trying to handle the entire, massive React.CSSProperties type,
// which was causing the "union type too complex" error.
type AnimatableCSSProperties = 'transform' | 'transformOrigin' | 'opacity' | 'backgroundColor' | 'width' | 'height' | 'borderRadius' | 'color' | 'filter' | 'textShadow';

// Helper to parse transform string into a structured object
const parseTransform = (transform: string | undefined): Record<string, { value: number; unit: string }> => {
    const result: Record<string, { value: number; unit: string }> = {};
    if (!transform) return result;
    const regex = /(\w+)\(([^)]+)\)/g;
    let match;
    while ((match = regex.exec(transform)) !== null) {
        const [, func, valStr] = match;
        const valMatch = valStr.match(/(-?\d*\.?\d+)(.*)/);
        if (valMatch) {
            result[func] = { value: parseFloat(valMatch[1]), unit: valMatch[2] || '' };
        }
    }
    return result;
};

const useAnimatedStyle = (keyframes: AnimationKeyframe[] | undefined, duration: number) => {
    const frame = useCurrentFrame();

    return useMemo(() => {
        const finalStyle: React.CSSProperties = {};
        if (!keyframes || keyframes.length < 1) return finalStyle;

        const sortedKeyframes = [...keyframes].sort((a, b) => a.at - b.at);

        const properties = new Set<AnimatableCSSProperties>();
        sortedKeyframes.forEach(kf => Object.keys(kf.style).forEach(p => properties.add(p as AnimatableCSSProperties)));

        properties.forEach(prop => {
            const keyframesForProp = sortedKeyframes.filter(kf => kf.style[prop] !== undefined);
            if (keyframesForProp.length === 0) return;

            if (keyframesForProp.length === 1) {
                Object.assign(finalStyle, { [prop]: keyframesForProp[0].style[prop] });
                return;
            }

            const inputRange = keyframesForProp.map(kf => kf.at * duration);

            if (prop === 'opacity') {
                // FIX: Ensure the output range is always an array of numbers.
                // The `React.CSSProperties` type allows opacity to be a string, but Remotion's
                // `interpolate` requires numbers. `parseFloat` safely handles this.
                const outputRange = keyframesForProp.map(kf => parseFloat(String(kf.style.opacity ?? 1)));
                finalStyle.opacity = interpolate(frame, inputRange, outputRange, { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            } else if (prop === 'color' || prop === 'backgroundColor') {
                 const outputRange = keyframesForProp.map(kf => String(kf.style[prop]));
                 finalStyle[prop] = interpolateColors(frame, inputRange, outputRange);
            } else if (prop === 'transform') {
                const allFuncs = new Set<string>();
                keyframesForProp.forEach(kf => {
                    const parsed = parseTransform(kf.style.transform);
                    Object.keys(parsed).forEach(key => allFuncs.add(key));
                });

                const finalTransforms: string[] = [];
                allFuncs.forEach(func => {
                    let lastValue: number | undefined;
                    let lastUnit: string | undefined;

                    const funcInputRange: number[] = [];
                    const funcOutputRange: number[] = [];
                    
                    sortedKeyframes.forEach(kf => {
                        const parsed = parseTransform(kf.style.transform);
                        const defaultValue = func.includes('scale') ? 1 : 0;
                        const defaultUnit = func.includes('rotate') ? 'deg' : (func.includes('translate') ? 'px' : '');
                        
                        if(lastUnit === undefined) lastUnit = defaultUnit;

                        if (parsed[func]) {
                           if(lastUnit === defaultUnit) lastUnit = parsed[func].unit;
                           lastValue = parsed[func].value;
                        } else if(lastValue === undefined) {
                           lastValue = defaultValue;
                        }
                        
                        funcInputRange.push(kf.at * duration);
                        funcOutputRange.push(lastValue);
                    });
                    
                    if (funcInputRange.length > 1) {
                        const interpolatedValue = interpolate(frame, funcInputRange, funcOutputRange);
                        finalTransforms.push(`${func}(${interpolatedValue}${lastUnit})`);
                    }
                });
                finalStyle.transform = finalTransforms.join(' ');
            } else {
                // For other properties (width, height, filter, etc.), use step interpolation
                let currentStyleValue = keyframesForProp[0].style[prop];
                for (let i = 0; i < inputRange.length; i++) {
                    if (frame >= inputRange[i]) {
                        currentStyleValue = keyframesForProp[i].style[prop];
                    }
                }
                finalStyle[prop] = currentStyleValue as any;
            }
        });

        return finalStyle;
    }, [frame, keyframes, duration]);
};


const AnimatedElement: React.FC<{ element: AnimationElement; sceneDuration: number; }> = ({ element, sceneDuration }) => {
    const animatedStyle = useAnimatedStyle(element.keyframes, sceneDuration);

    const baseStyle: React.CSSProperties = {
        position: 'absolute',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        top: '50%',
        left: '50%',
        // Default transform to center the element, will be overridden by animation
        transform: 'translate(-50%, -50%)',
    };

    if (element.type === 'shape' && element.shape === 'circle') {
        baseStyle.borderRadius = '50%';
    }
    
    if (element.type === 'text') {
        baseStyle.textAlign = 'center';
        baseStyle.fontSize = 'clamp(1rem, 5vw, 3.5rem)';
        baseStyle.fontWeight = 700;
        baseStyle.lineHeight = '1.2';
        baseStyle.color = 'white'; // default
    }

    // Combine transform from base and animation
    const finalStyle = {...baseStyle, ...animatedStyle};
    if (baseStyle.transform && animatedStyle.transform) {
      finalStyle.transform = `${baseStyle.transform} ${animatedStyle.transform}`;
    }

    return (
        <div style={finalStyle}>
            {element.type === 'text' ? element.text : null}
        </div>
    );
};


interface SceneComponentProps {
    scene: Scene;
    isFirst: boolean;
    isLast: boolean;
    sceneDuration: number;
    transitionDuration: number;
    index: number;
}

const getKenBurnsEffect = (frame: number, duration: number, index: number) => {
    const progress = frame / duration;
    const isEven = index % 2 === 0;
    const scale = interpolate(progress, [0, 1], isEven ? [1, 1.1] : [1.1, 1]);
    const rotate = interpolate(progress, [0, 1], isEven ? [-1, 1] : [1, -1]);
    return { transform: `scale(${scale}) rotate(${rotate}deg)` };
}

const SceneComponent: React.FC<SceneComponentProps> = ({ scene, isFirst, isLast, sceneDuration, transitionDuration, index }) => {
    const frame = useCurrentFrame();
    const { durationInFrames } = useVideoConfig();

    const opacity = (() => {
        if (isFirst && isLast) return 1;
        if (isFirst) {
            return interpolate(frame, [sceneDuration, sceneDuration + transitionDuration], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        }
        if (isLast) {
            return interpolate(frame, [0, transitionDuration], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        }
        const fadeIn = interpolate(frame, [0, transitionDuration], [0, 1], { extrapolateRight: 'clamp' });
        const fadeOut = interpolate(frame, [sceneDuration, sceneDuration + transitionDuration], [1, 0], { extrapolateLeft: 'clamp' });
        return Math.min(fadeIn, fadeOut);
    })();
    
    const imageTransforms = getKenBurnsEffect(frame, durationInFrames, index);
    const cameraStyle = useAnimatedStyle(scene.cameraAnimation, sceneDuration);

    return (
        <AbsoluteFill style={{ opacity, backgroundColor: scene.backgroundColor || 'transparent' }}>
            {scene.imageUrl && (
                 <Img
                    src={scene.imageUrl}
                    style={{
                        position: 'absolute',
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        ...imageTransforms,
                    }}
                />
            )}
            <AbsoluteFill style={{
                background: scene.imageUrl ? 'linear-gradient(to top, rgba(0,0,0,0.4) 0%, transparent 50%)' : 'none',
                perspective: '2000px', // Add perspective for 3D transforms to work
                transformStyle: 'preserve-3d', // Necessary for children to have 3D space
            }}>
                <AbsoluteFill style={cameraStyle}>
                  {scene.animationElements.map(el => (
                      <AnimatedElement key={el.id} element={el} sceneDuration={sceneDuration} />
                  ))}
                </AbsoluteFill>
            </AbsoluteFill>
        </AbsoluteFill>
    );
};

type AnimationProps = {
    videoResult: VideoResult;
};

const Animation: React.FC<AnimationProps> = ({ videoResult }) => {
    const { scenes, backgroundColor } = videoResult;

    if (!scenes || scenes.length === 0) {
        return <AbsoluteFill style={{backgroundColor: 'black', justifyContent: 'center', alignItems: 'center', color: 'white', fontSize: 24}}>Animation data is missing or invalid.</AbsoluteFill>;
    }
    
    const DURATION_PER_SCENE = 90; // 3 seconds at 30fps
    const TRANSITION_DURATION = 30; // 1 second

    return (
        <AbsoluteFill style={{ backgroundColor: 'black' }}>
            {scenes.map((scene, index) => {
                const finalScene = {
                    ...scene,
                    backgroundColor: !scene.imageUrl && backgroundColor ? backgroundColor : scene.backgroundColor,
                };
                return (
                    <Sequence
                        key={index}
                        from={index * DURATION_PER_SCENE}
                        durationInFrames={DURATION_PER_SCENE + TRANSITION_DURATION}
                    >
                        <SceneComponent
                            scene={finalScene}
                            isFirst={index === 0}
                            isLast={index === scenes.length - 1}
                            sceneDuration={DURATION_PER_SCENE}
                            transitionDuration={TRANSITION_DURATION}
                            index={index}
                        />
                    </Sequence>
                );
            })}
        </AbsoluteFill>
    );
};

interface VideoPlayerProps {
    videoResult: VideoResult;
}

const getDimensions = (aspectRatio: AspectRatio) => {
    const baseResolution = 1280;
    const [w, h] = aspectRatio.split(':').map(Number);
    
    if (w > h) { // Landscape
      return { width: baseResolution, height: (baseResolution * h) / w };
    }
    if (h > w) { // Portrait
      return { width: (baseResolution * w) / h, height: baseResolution };
    }
    // Square
    return { width: 1080, height: 1080 };
};
  

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ videoResult }) => {
    const DURATION_PER_SCENE = 90;
    const TRANSITION_DURATION = 30;
    
    const DURATION = videoResult.scenes && videoResult.scenes.length > 0
        ? (videoResult.scenes.length * DURATION_PER_SCENE) + TRANSITION_DURATION
        : DURATION_PER_SCENE;
        
    const FPS = 30;
    const { width, height } = getDimensions(videoResult.aspectRatio);
  
    return (
        <div className={videoResult.transparentBackground ? 'checkerboard' : ''} style={{ aspectRatio: videoResult.aspectRatio.replace(':', ' / '), width: '100%' }}>
            <Player
                component={Animation}
                inputProps={{ videoResult }}
                durationInFrames={DURATION}
                fps={FPS}
                compositionWidth={width}
                compositionHeight={height}
                style={{ width: '100%', height: '100%' }}
                controls
                loop
                autoPlay
            />
        </div>
    );
};