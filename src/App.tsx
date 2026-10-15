import React from "react";
import { ThemeProvider } from "theme-ui";
import { BrowserRouter as Router, Switch, Route } from "react-router-dom";

import theme from "./theme";
import Home from "./routes/Home";
import Game from "./routes/Game";

import { AuthProvider } from "./contexts/AuthContext";
import { SettingsProvider } from "./contexts/SettingsContext";
import { KeyboardProvider } from "./contexts/KeyboardContext";
import { DatabaseProvider } from "./contexts/DatabaseContext";
import { UserIdProvider } from "./contexts/UserIdContext";

import { ToastProvider } from "./components/Toast";

// Info pages are loaded when visited, not with every game
const About = React.lazy(() => import("./routes/About"));
const FAQ = React.lazy(() => import("./routes/FAQ"));
const ReleaseNotes = React.lazy(() => import("./routes/ReleaseNotes"));
const HowTo = React.lazy(() => import("./routes/HowTo"));

function App() {
  return (
    <ThemeProvider theme={theme}>
      <SettingsProvider>
        <AuthProvider>
          <KeyboardProvider>
            <ToastProvider>
              <Router>
                <React.Suspense fallback={null}>
                  <Switch>
                    <Route path="/how-to">
                      <HowTo />
                    </Route>
                    <Route path="/release-notes">
                      <ReleaseNotes />
                    </Route>
                    <Route path="/about">
                      <About />
                    </Route>
                    <Route path="/faq">
                      <FAQ />
                    </Route>
                    <Route path="/game/:id">
                      <DatabaseProvider>
                        <UserIdProvider>
                          <Game />
                        </UserIdProvider>
                      </DatabaseProvider>
                    </Route>
                    <Route path="/">
                      <Home />
                    </Route>
                  </Switch>
                </React.Suspense>
              </Router>
            </ToastProvider>
          </KeyboardProvider>
        </AuthProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}

export default App;
