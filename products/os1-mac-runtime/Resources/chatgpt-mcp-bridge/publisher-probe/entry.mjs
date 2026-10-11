import appHTML from './app.html';
import {createProbeWorker} from './worker.mjs';
export {NativeChatProbe} from './worker.mjs';
export default createProbeWorker({appHTML});
