
import { GoogleGenAI, Type } from '@google/genai';
import { LoadingState, VideoResult, AspectRatio } from '../types';
import { generateStoryboardViaProxy } from './proxy';

const DURATION_PER_SCENE = 3;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const generateVideo = async (
  prompt: string,
  config: {
    duration: number;
    aspectRatio: AspectRatio;
    generateNarration: boolean;
    textColor: string;
    transparentBackground: boolean;
    backgroundColor?: string;
  },
  onProgress: (state: LoadingState) => void
): Promise<VideoResult> => {
  const ai = new GoogleGenAI({apiKey: process.env.API_KEY});
  const sceneCount = Math.max(2, Math.ceil(config.duration / DURATION_PER_SCENE));
  const totalSteps = 2 + sceneCount + (config.generateNarration ? 1 : 0);
  
  onProgress({ step: 1, totalSteps, message: 'Designing motion graphics...' });

  const storyboardPrompt = `
The user wants a video about: "${prompt}".
The video will be ${config.duration} seconds long, with about ${DURATION_PER_SCENE} seconds per scene, so create ${sceneCount} scenes.
The primary text color should be ${config.textColor}.
`;

  let storyboardResponseText;
  try {
    storyboardResponseText = await generateStoryboardViaProxy(storyboardPrompt);
  } catch (e) {
      console.error(e);
      throw new Error(`Failed to generate storyboard. ${(e as Error).message}`);
  }
  
  const storyboard = JSON.parse(storyboardResponseText).scenes;

  let narration;
  if (config.generateNarration) {
      onProgress({ step: 2, totalSteps, message: 'Writing narration script...' });
      const narrationPrompt = `Based on the following scene descriptions (extracted from the main text element of each scene), write a concise and engaging narration script.
Provide one narration line per scene.
Scenes:
${storyboard.map((s: any, i: number) => {
    const textEl = s.animationElements.find((el: any) => el.type === 'text');
    return (i+1) + '. ' + (textEl ? textEl.text : 'A visual scene.');
}).join('\\n')}`;

      const narrationSchema = {
          type: Type.OBJECT,
          properties: {
              narration: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
              }
          }
      };
      try {
        const narrationResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: narrationPrompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: narrationSchema
            }
        });
        narration = JSON.parse(narrationResponse.text).narration;
      } catch (e) {
        console.error(e);
        narration = undefined; 
      }
  }

  const scenes: any[] = [];
  const imageGenStepStart = 2 + (config.generateNarration ? 1 : 0);

  for (let i = 0; i < storyboard.length; i++) {
    const sceneSpec = storyboard[i];
    const currentStep = i + imageGenStepStart;

    if (sceneSpec.image_prompt) {
        onProgress({
            step: currentStep,
            totalSteps,
            message: `Generating image for scene ${i + 1}/${storyboard.length}...`
        });
        
        try {
            const imageResponse = await ai.models.generateImages({
                model: 'imagen-3.0-generate-002',
                prompt: `${sceneSpec.image_prompt}, professional motion graphic background, high quality, visually stunning, abstract`,
                config: {
                    numberOfImages: 1,
                    outputMimeType: 'image/jpeg',
                    aspectRatio: config.aspectRatio,
                },
            });

            const base64ImageBytes = imageResponse.generatedImages[0].image.imageBytes;
            scenes.push({
                animationElements: sceneSpec.animationElements,
                cameraAnimation: sceneSpec.camera_animation,
                imageUrl: `data:image/jpeg;base64,${base64ImageBytes}`,
                backgroundColor: sceneSpec.background_color,
            });

        } catch (error) {
            console.error(`Failed to generate image for scene ${i + 1}:`, error);
            scenes.push({
                animationElements: sceneSpec.animationElements,
                cameraAnimation: sceneSpec.camera_animation,
                backgroundColor: sceneSpec.background_color,
            });
        }
    } else {
        onProgress({
            step: currentStep,
            totalSteps,
            message: `Processing scene ${i + 1}/${storyboard.length}...`
        });
        scenes.push({
            animationElements: sceneSpec.animationElements,
            cameraAnimation: sceneSpec.camera_animation,
            backgroundColor: sceneSpec.background_color,
        });
        await sleep(250);
    }
  }

  onProgress({ step: totalSteps, totalSteps, message: 'Finalizing video...' });
  await sleep(500);

  return {
    scenes,
    narration,
    aspectRatio: config.aspectRatio,
    textColor: config.textColor,
    transparentBackground: config.transparentBackground,
    backgroundColor: config.backgroundColor,
  };
};
