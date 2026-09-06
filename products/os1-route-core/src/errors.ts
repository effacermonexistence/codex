export class RequestRejected extends Error {
  constructor() {
    super("request rejected");
    this.name = "RequestRejected";
  }
}

export function reject(): never {
  throw new RequestRejected();
}

export class ResultServiceUnavailable extends Error {
  constructor() { super("result service unavailable"); this.name = "ResultServiceUnavailable"; }
}
