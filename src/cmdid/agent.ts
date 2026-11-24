import { abc, installAgent } from "../agent.js";

installAgent();
setImmediate(() => {
    try { abc.cmdid.dump(); }
    catch (error) { send({ event: "cmdid-error", error: String(error) }); }
});
