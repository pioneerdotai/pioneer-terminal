// Local PTYs must stay outside the production entry dependency graph.
import { createDevelopmentTerminal } from "./server/terminal/development";
import { startServer } from "./server/start";

startServer(createDevelopmentTerminal());
