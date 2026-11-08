let pendingWrite: Promise<void> = Promise.resolve();

export function serializeStorageWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingWrite.then(operation, operation);
  pendingWrite = result.then(() => undefined, () => undefined);
  return result;
}
