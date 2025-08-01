import { Type } from '@google/genai';

let iframe: HTMLIFrameElement | null = null;
let isProxyReady = false;
let readyPromise: Promise<void> | null = null;
const requestQueue = new Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void; }>();

function generateId() {
    return Math.random().toString(36).substring(2, 15);
}

function createInjectedScript(apiKey: string) {
    const keyframeSchema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            at: { type: Type.NUMBER },
            style: { type: Type.OBJECT, properties: {
                transform: { type: Type.STRING, nullable: true },
                transformOrigin: { type: Type.STRING, nullable: true },
                opacity: { type: Type.NUMBER, nullable: true },
                backgroundColor: { type: Type.STRING, nullable: true },
                width: { type: Type.STRING, nullable: true },
                height: { type: Type.STRING, nullable: true },
                borderRadius: { type: Type.STRING, nullable: true },
                color: { type: Type.STRING, nullable: true },
                filter: { type: Type.STRING, nullable: true, description: "CSS filter property, e.g., 'blur(5px)'" },
                textShadow: { type: Type.STRING, nullable: true, description: "CSS text-shadow property, e.g., '2px 2px 4px #000000'" },
            } },
          },
          required: ["at", "style"],
        }
    };

    const storyboardSchema = {
        type: Type.OBJECT,
        properties: {
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                animationElements: {
                  type: Type.ARRAY,
                  description: "List of elements to animate in the scene.",
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      type: { type: Type.STRING, enum: ["text", "shape"] },
                      text: { type: Type.STRING, nullable: true },
                      shape: { type: Type.STRING, enum: ["rectangle", "circle"], nullable: true },
                      keyframes: keyframeSchema
                    },
                    required: ["id", "type", "keyframes"],
                  }
                },
                camera_animation: { ...keyframeSchema, description: "Keyframes for the scene's camera movement (pan, zoom, rotate)." },
                image_prompt: { type: Type.STRING, description: "Prompt for an image generator. Null if not needed.", nullable: true },
                background_color: { type: Type.STRING, description: "Background color as a hex code." },
              },
              required: ["animationElements", "background_color", "camera_animation"],
            }
          }
        }
    };

    const systemInstruction = `You are a world-class motion design director. Your task is to conceptualize and define a high-end, visually stunning animation based on a user's prompt. You will respond with a single JSON object that strictly adheres to the provided JSON schema.

Core Principles:
1.  **Cinematic & Professional:** Aim for clean, elegant, and impactful visuals. Use composition effectively.
2.  **Fluid Motion:** Create smooth animations using multiple keyframes (e.g., at: 0, 0.5, 1). Motion should be fluid, not linear.
3.  **Depth & Effects:**
    - Utilize 3D transformations: \`perspective\`, \`rotateX\`, \`rotateY\`, \`translateZ\`.
    - Employ \`filter\` for effects like \`blur()\` and \`drop-shadow()\`.
    - Use \`textShadow\` for glows and depth.
    - Animate \`opacity\` for fades.
4.  **Layout:** Avoid centering all elements. Create interesting, dynamic layouts. Use relative units ('%', 'vw', 'vh') for responsive design.
5.  **Text Color:** The main text elements should use the color specified in the user's prompt.

Scene Contents:
1.  **animationElements**: Define all objects to be animated.
2.  **camera_animation**: Create camera movements (pan, zoom, rotate) for a dynamic feel. This is almost always required.
3.  **image_prompt**: Write a DALL-E 3 style, detailed prompt for a background image. Prefer abstract, moody, and atmospheric visuals (e.g., gradients, textures, nebulae) unless the prompt is specific. Use 'null' if no image is needed.
4.  **background_color**: Provide a CSS hex color for the background if no image is used.`;

    return `
        import { GoogleGenAI } from 'https://esm.sh/@google/genai';
        
        try {
            const ai = new GoogleGenAI({ apiKey: '${apiKey}' });
            
            const storyboardSchema = ${JSON.stringify(storyboardSchema)};
            const systemInstruction = \`${systemInstruction.replace(/`/g, '\\`')}\`;

            window.addEventListener('message', async (event) => {
                if (event.source !== window.parent || !event.data) {
                    return;
                }
                const { id, prompt } = event.data;
                if (!id || !prompt) return;

                try {
                    // Using the Chat API. A new chat is created for each
                    // request to ensure it remains stateless and avoids history buildup.
                    const chat = ai.chats.create({
                        model: 'gemini-2.5-flash',
                        config: {
                            systemInstruction: systemInstruction,
                            responseMimeType: 'application/json',
                        }
                    });

                    // Since chat doesn't use responseSchema, we add the schema instructions
                    // directly into the user prompt.
                    const schemaInstruction = 'You MUST respond with a single JSON object that strictly adheres to the following JSON schema. Do not add any other text, just the raw JSON object. Schema: ' + JSON.stringify(storyboardSchema);
                    const fullPrompt = prompt + '\\n\\n' + schemaInstruction;
                    
                    const response = await chat.sendMessage({ message: fullPrompt });

                    window.parent.postMessage({ id, payload: response.text }, '*');
                } catch (e) {
                    console.error('Error in iframe chat.sendMessage:', e);
                    window.parent.postMessage({ id, error: (e as Error).message || 'Unknown error in API proxy' }, '*');
                }
            });
            window.parent.postMessage({ id: 'proxy-ready' }, '*');
        } catch (e) {
            console.error("Error initializing proxy script:", e);
            window.parent.postMessage({ id: 'proxy-init-error', error: (e as Error).message }, '*');
        }
    `;
}

function initProxy() {
    if (readyPromise) return readyPromise;

    readyPromise = new Promise((resolve, reject) => {
        iframe = document.createElement('iframe');
        iframe.style.display = 'none';

        // Use srcdoc to inject the content directly, avoiding cross-origin issues.
        const apiKey = process.env.API_KEY;
        if (!apiKey) {
            return reject(new Error("API_KEY environment variable not set."));
        }
        const injectedScript = createInjectedScript(apiKey);
        iframe.srcdoc = `
            <!DOCTYPE html>
            <html>
            <head><title>API Proxy</title></head>
            <body>
                <script type="module">${injectedScript}</script>
            </body>
            </html>
        `;

        document.body.appendChild(iframe);

        const messageHandler = (event: MessageEvent) => {
            if (event.source !== iframe?.contentWindow || !event.data) return;
            
            const { id, error } = event.data;
            if (id === 'proxy-ready') {
                isProxyReady = true;
                window.removeEventListener('message', messageHandler);
                setupResponseListener();
                resolve();
            } else if (id === 'proxy-init-error') {
                 reject(new Error(`Proxy Init Error: ${error}`));
                 window.removeEventListener('message', messageHandler);
            }
        };

        window.addEventListener('message', messageHandler);
    });
    
    return readyPromise;
}

function setupResponseListener() {
     window.addEventListener('message', (event) => {
        if (event.source !== iframe?.contentWindow || !event.data) return;

        const { id, payload, error } = event.data;
        const request = requestQueue.get(id);

        if (request) {
            if (error) {
                request.reject(new Error(error));
            } else {
                request.resolve(payload);
            }
            requestQueue.delete(id);
        }
    });
}

export async function generateStoryboardViaProxy(prompt: string): Promise<any> {
    await initProxy();
    
    if (!isProxyReady || !iframe || !iframe.contentWindow) {
        throw new Error("Iframe proxy is not ready or available.");
    }
    
    const id = generateId();
    const promise = new Promise((resolve, reject) => {
        requestQueue.set(id, { resolve, reject });
    });
    
    iframe.contentWindow.postMessage({ id, prompt }, '*');
    
    return promise;
}
