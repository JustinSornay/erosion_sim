/** Lucide pictograms shared by simulation controls and source actions. */
import {
  createElement,
  ChevronLeft,
  Clock,
  Droplet,
  Eraser,
  FolderOpen,
  Gauge,
  Mountain,
  Pause,
  Play,
  RotateCw,
  Save,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Waves,
  X,
} from "lucide";

const icons = {
  "chevron-left": ChevronLeft,
  clock: Clock,
  droplet: Droplet,
  eraser: Eraser,
  "folder-open": FolderOpen,
  gauge: Gauge,
  mountain: Mountain,
  pause: Pause,
  play: Play,
  "rotate-cw": RotateCw,
  save: Save,
  "toggle-left": ToggleLeft,
  "toggle-right": ToggleRight,
  "trash-2": Trash2,
  waves: Waves,
  x: X,
};

/** Decorative icons inherit their accessible meaning from the surrounding control. */
export function createIcon(name) {
  return createElement(icons[name], {
    class: "icon",
    "data-icon": name,
    "aria-hidden": "true",
    focusable: "false",
  });
}

/** Keep the SVG element stable so playback and source controls retain their references. */
export function setIcon(element, name) {
  const icon = createIcon(name);
  for (const attribute of icon.attributes) {
    element.setAttribute(attribute.name, attribute.value);
  }
  element.replaceChildren(...icon.childNodes);
}

export function initializeIcons() {
  document.querySelectorAll("svg[data-icon]").forEach((element) => {
    setIcon(element, element.dataset.icon);
  });
}
