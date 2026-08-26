import {
  FROZEN_TOOL_NAMES,
  createWebMcpTools,
  type WebMcpToolRuntime,
} from './contracts';

export type WebMcpRegistration = {
  readonly supported: boolean;
  readonly unregister: () => void;
};

/**
 * Register the frozen surface once for this page lifecycle. AbortSignal is the
 * native lifecycle/unregistration mechanism; unsupported browsers stay manual.
 */
export const registerWebMcpTools = (
  runtime: WebMcpToolRuntime,
): WebMcpRegistration => {
  if (!document.modelContext) {
    return {
      supported: false,
      unregister: () => undefined,
    };
  }

  const controller = new AbortController();
  const tools = createWebMcpTools(runtime);

  if (
    tools.length !== FROZEN_TOOL_NAMES.length ||
    tools.some((tool, index) => tool.name !== FROZEN_TOOL_NAMES[index])
  ) {
    throw new Error('REDLINE must register exactly the frozen WebMCP tool surface.');
  }

  for (const tool of tools) {
    const registration = document.modelContext.registerTool(tool, {
      signal: controller.signal,
    });

    // Chrome can reject an in-flight registration after React's development
    // lifecycle aborts it. Consume that expected teardown result without
    // masking a non-abort registration problem in the console.
    void Promise.resolve(registration).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        console.error('REDLINE WebMCP tool registration failed.', error);
      }
    });
  }

  return {
    supported: true,
    unregister: () => controller.abort(),
  };
};
