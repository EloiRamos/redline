type WebMcpJsonSchema = {
  readonly type?: string;
  readonly description?: string;
  readonly properties?: Readonly<Record<string, WebMcpJsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly items?: WebMcpJsonSchema;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly minLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly enum?: readonly (string | number)[];
  readonly const?: string | number;
  readonly oneOf?: readonly WebMcpJsonSchema[];
};

type WebMcpToolResult = {
  readonly content: readonly {
    readonly type: 'text';
    readonly text: string;
  }[];
};

type WebMcpTool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: WebMcpJsonSchema;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
  };
  readonly execute: (input: unknown) => Promise<WebMcpToolResult>;
};

type WebMcpModelContext = {
  readonly registerTool: (
    tool: WebMcpTool,
    options: { readonly signal: AbortSignal },
  ) => void | Promise<void>;
};

interface Document {
  readonly modelContext?: WebMcpModelContext;
}
