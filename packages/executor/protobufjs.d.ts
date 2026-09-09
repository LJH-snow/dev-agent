declare module "protobufjs" {
  export interface Root {
    lookupType(name: string): Type;
  }

  export interface Type {
    create(properties: Record<string, unknown>): Message;
    encode(message: Message): Encoder;
    decode(reader: Uint8Array): Message;
  }

  export interface Message {
    toJSON(): Record<string, unknown>;
  }

  export interface Encoder {
    finish(): Uint8Array;
  }

  export function parse(proto: string): { root: Root };
}
