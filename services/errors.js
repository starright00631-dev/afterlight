export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function aborted(signal) {
  if (signal?.aborted) throw new HttpError(499, 'cancelled', 'The request was cancelled.');
}
