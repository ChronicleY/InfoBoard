import type { ClassifierWorkerRequest, ClassifierWorkerResponse } from "../../modules/classifier/workerProtocol";

const worker = new Worker(new URL("./classifier.worker.ts", import.meta.url), { type: "module" });
const responses = new Map<string, (response: ClassifierWorkerResponse) => void>();

worker.addEventListener("message", (event: MessageEvent<ClassifierWorkerResponse>) => {
  const respond = responses.get(event.data.id);
  if (!respond) return;
  responses.delete(event.data.id);
  respond(event.data);
});

worker.addEventListener("error", (event) => {
  for (const respond of responses.values()) {
    respond({ id: "", success: false, error: event.message || "分类 Worker 运行失败" });
  }
  responses.clear();
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || (message as { target?: string }).target !== "classifier-offscreen") {
    return undefined;
  }
  const request = message as ClassifierWorkerRequest;
  responses.set(request.id, sendResponse);
  worker.postMessage(request);
  return true;
});
