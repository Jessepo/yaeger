import "./style.css";
import van from "vanjs-core";
import { roastApp } from "./roast";

van.add(document.getElementById("app")!, roastApp());
