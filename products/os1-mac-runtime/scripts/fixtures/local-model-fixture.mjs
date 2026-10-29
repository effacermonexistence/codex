// Build 446 (DESIGN-5 §B): in production the OS-1 bridge plugin configures the
// host's one local model from its plugin config (`local_model`, decided by the
// Swift host's LocalModelSelection). Fixtures that drive Core, the plugin or
// the planner without the host import this first: the fixtures' local model.
import {configureLocalModel} from '../../Resources/openclaw-os1-bridge/resource-usage.mjs';
export const FIXTURE_LOCAL_MODEL = configureLocalModel('qwen3.5:4b');
