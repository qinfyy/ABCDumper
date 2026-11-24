import { installAgent } from "./agent.js";
//import { dump, dumpStatus } from "./dumper.js";

installAgent();
// setImmediate(() => {
//     if (!dumpStatus().active && !dumpStatus().result) {
//         dump().catch(error => send({ event: "dump-error", error: String(error) }));
//     }
// });
