import uiHtml from "./ui.html";
import { convertSelectedNode, type FigmaLikeNode } from "../../packages/converter-engine/src/index";

figma.showUI(uiHtml, { width: 460, height: 680, themeColors: true });

function toPortableNode(node: SceneNode): FigmaLikeNode {
  const portable: FigmaLikeNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible,
  };

  if ("characters" in node) portable.characters = node.characters;
  if (node.type === "TEXT") {
    portable.style = {
      ...(typeof node.fontSize === "number" ? { fontSize: node.fontSize } : {}),
      ...(typeof node.fontWeight === "number" ? { fontWeight: node.fontWeight } : {}),
    };
  }
  if ("layoutMode" in node) portable.layoutMode = node.layoutMode;
  if ("paddingTop" in node) {
    portable.paddingTop = node.paddingTop;
    portable.paddingRight = node.paddingRight;
    portable.paddingBottom = node.paddingBottom;
    portable.paddingLeft = node.paddingLeft;
    portable.itemSpacing = node.itemSpacing;
  }
  if ("cornerRadius" in node && typeof node.cornerRadius === "number") {
    portable.cornerRadius = node.cornerRadius;
  }
  if ("fills" in node && Array.isArray(node.fills)) {
    portable.fills = node.fills
      .filter((paint) => paint.type === "SOLID" || paint.type === "GRADIENT_LINEAR" || paint.type === "IMAGE")
      .map((paint) => ({
        type: paint.type,
        visible: paint.visible,
        opacity: paint.opacity,
        ...("color" in paint && paint.color ? { color: paint.color } : {}),
      }));
  }
  if ("children" in node) {
    portable.children = Array.from(node.children).map(toPortableNode);
  }
  return portable;
}

function postSelection() {
  const selected = figma.currentPage.selection[0];
  figma.ui.postMessage({
    type: "selection",
    selection: selected ? { name: selected.name, type: selected.type } : null,
  });
}

figma.on("selectionchange", postSelection);

figma.ui.onmessage = (message) => {
  if (message.type === "convert-selection") {
    const selected = figma.currentPage.selection[0];
    if (!selected) {
      figma.ui.postMessage({
        type: "conversion-error",
        message: "Select one frame, component, or group to export.",
      });
      return;
    }

    const result = convertSelectedNode(toPortableNode(selected));
    figma.ui.postMessage({ type: "conversion", result });
  }

  if (message.type === "close") figma.closePlugin();
};

postSelection();

