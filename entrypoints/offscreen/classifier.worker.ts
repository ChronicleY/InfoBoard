/// <reference lib="webworker" />
import { classifyWithModel, trainClassifier } from "../../modules/classifier/naiveBayes";
import type { ClassifierWorkerRequest, ClassifierWorkerResponse } from "../../modules/classifier/workerProtocol";

self.addEventListener("message", (event: MessageEvent<ClassifierWorkerRequest>) => {
  const { id, task } = event.data;
  try {
    let result: ClassifierWorkerResponse["result"];
    switch (task.type) {
      case "bootstrap":
        result = trainClassifier([], 1, task.categories);
        break;
      case "train":
        result = trainClassifier(task.examples, task.version, task.categories, task.retiredCategoryIds);
        break;
      case "classify":
        result = classifyWithModel(task.article, task.model);
        break;
      case "classify-batch":
        result = task.articles.map((article) => classifyWithModel(article, task.model));
        break;
    }
    const response: ClassifierWorkerResponse = { id, success: true, result };
    self.postMessage(response);
  } catch (error) {
    const response: ClassifierWorkerResponse = { id, success: false, error: String(error) };
    self.postMessage(response);
  }
});
