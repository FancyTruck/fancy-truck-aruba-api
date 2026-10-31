// One interactive MIME operation per owning process. Reject excess requests
// instead of queuing request state or allocating another source/parser buffer.
export function createMailReadGate() {
  let busy = false;
  return { claim(response) {
    if (busy) return null;
    busy = true;
    let workDone = false, responseDone = Boolean(response.destroyed || response.writableFinished), released = false;
    const releaseIfDone = () => {
      if (!released && workDone && responseDone) {
        released = true;
        busy = false;
        response.removeListener('finish', onEnd);
        response.removeListener('close', onEnd);
      }
    };
    const onEnd = () => { responseDone = true; releaseIfDone(); };
    response.once('finish', onEnd);
    response.once('close', onEnd);
    // Disconnect is not completion: pending provider/parser work still owns it.
    return () => { workDone = true; releaseIfDone(); };
  } };
}
