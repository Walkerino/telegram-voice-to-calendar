export type TranscribeInput = {
  audio: Buffer;
  mimeType: string;
  fileName?: string;
};

export type TranscribeOutput = {
  text: string;
  provider: string;
};

export interface ITranscriber {
  transcribe(input: TranscribeInput): Promise<TranscribeOutput>;
}
