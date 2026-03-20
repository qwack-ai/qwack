// @qwack/web — Root application component
// See AGENTS.md for component spec

import { Router, Route } from "@solidjs/router";
import Landing from "./routes/Landing";
import Terms from "./routes/Terms";
import Privacy from "./routes/Privacy";

export default function App() {
  return (
    <Router>
      <Route path="/" component={Landing} />
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
    </Router>
  );
}
