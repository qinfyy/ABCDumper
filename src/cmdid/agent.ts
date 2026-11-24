import { installAgent, ys } from "../agent.js";

installAgent();
setImmediate(() => {
    try { ys.cmdid.dump(); }
    catch (error) { send({ event: "cmdid-error", error: String(error) }); }
});
