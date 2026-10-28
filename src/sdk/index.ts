export { StreamUIClient, createClient, request } from './client.ts';
export type { SceneSlot, SceneState, PublicState, CoreSettings, ChatMessage, PluginInfo, TransitionContext, TransitionModule } from './contracts.ts';

export function getSceneContext() { const params = new URLSearchParams(location.search); return { sceneId: params.get('streamuiScene'), pluginId: params.get('streamuiPlugin'), preview: params.has('streamuiPreview') }; }
