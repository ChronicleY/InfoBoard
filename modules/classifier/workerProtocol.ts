import type { ClassifierModel } from "../types";
import type { CategoryDef } from "../types";
import type { ClassificationResult, ClassifierText, LabeledClassifierText } from "./naiveBayes";

export type ClassifierTask =
  | { type: "bootstrap"; categories?: CategoryDef[] }
  | { type: "train"; examples: LabeledClassifierText[]; version: number; categories?: CategoryDef[]; retiredCategoryIds?: Record<string, string> }
  | { type: "classify"; article: ClassifierText; model: ClassifierModel }
  | { type: "classify-batch"; articles: ClassifierText[]; model: ClassifierModel };

export interface ClassifierWorkerRequest {
  id: string;
  task: ClassifierTask;
}

export interface ClassifierWorkerResponse {
  id: string;
  success: boolean;
  result?: ClassifierModel | ClassificationResult | ClassificationResult[];
  error?: string;
}
