import { render } from "preact"
import { App } from "./app"

const mount = document.getElementById("app")
if (mount) render(<App />, mount)
