import type { ClassifyOutput } from "./types";

export interface IClassifier {
  classify(text: string): Promise<ClassifyOutput>;
}
