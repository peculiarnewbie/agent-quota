import "./index.css";
import { render } from "solid-js/web";
import { initDesktopRpc } from "./lib/electrobun-rpc";
import App from "./App";

initDesktopRpc();

const root = document.getElementById("app");

if (root) {
	render(() => <App />, root);
}
