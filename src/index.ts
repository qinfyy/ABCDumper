import { abc, installAgent } from "./agent.js";
//import { dump, dumpStatus } from "./dumper.js";

installAgent();
setImmediate(() => {
    // if (!dumpStatus().active && !dumpStatus().result) {
    //     dump().catch(error => send({ event: "dump-error", error: String(error) }));
    // }
    const { active, result } = abc.gpb.status();
    if (active || result) return;
    abc.gpb.dump().then(() => {
        try { abc.cmdid.dump(); }
        catch (error) { send({ event: "cmdid-error", error: String(error) }); }
    }).catch(error => send({ event: "proto-error", error: String(error) }));
});
