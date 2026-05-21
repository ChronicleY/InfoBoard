import type { Message, MessageResponse } from "../types";

export async function sendMessage<T>(message: Message): Promise<MessageResponse<T>> {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
