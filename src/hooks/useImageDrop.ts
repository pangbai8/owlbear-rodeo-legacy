import { useState } from "react";
import { useToasts } from "react-toast-notifications";

import Vector2 from "../helpers/Vector2";
import {
  isMonsterDrag,
  MonsterStats,
  loadMonster,
  monsterTokenFile,
  parseMonsterDrag,
} from "../helpers/fiveETools";

export type ImageDropEvent = {
  files: File[];
  dropPosition: Vector2;
  /** A monster from the quick search: always a token, never a map */
  asToken?: boolean;
  /** That monster's stats (its ref is remembered on the token) */
  monster?: MonsterStats;
};

export type OtherFilesDropOptions = {
  /** Whether a drag holds only files for onOtherFiles (shown as draggingOther) */
  isOtherDrag?: (dataTransfer: DataTransfer | null) => boolean;
  /** Receives dropped files that are not images; returns those it did not take */
  onOtherFiles?: (files: File[]) => File[];
};

function useImageDrop(
  onImageDrop: (event: ImageDropEvent) => void,
  supportFileTypes = ["image/jpeg", "image/gif", "image/png", "image/webp"],
  { isOtherDrag, onOtherFiles }: OtherFilesDropOptions = {}
) {
  const { addToast } = useToasts();

  const [dragging, setDragging] = useState(false);
  const [draggingOther, setDraggingOther] = useState(false);
  const [draggingMonster, setDraggingMonster] = useState(false);
  function onDragEnter(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(true);
    setDraggingOther(!!isOtherDrag?.(event.dataTransfer));
    setDraggingMonster(isMonsterDrag(event.dataTransfer));
  }

  function onDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
  }

  function onDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  }

  async function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const dropPosition = new Vector2(event.clientX, event.clientY);

    // A monster dragged from the quick search: token art sized by creature size
    const monster = parseMonsterDrag(event.dataTransfer);
    if (monster) {
      setDragging(false);
      try {
        const stats = await loadMonster(monster);
        const file = await monsterTokenFile(stats);
        onImageDrop({ files: [file], dropPosition, asToken: true, monster: stats });
      } catch (e) {
        addToast(`无法添加怪物：${e instanceof Error ? e.message : e}`);
      }
      return;
    }

    let imageFiles = [];

    // Check if the dropped image is from a URL
    const html = event.dataTransfer?.getData("text/html");
    if (html) {
      try {
        const urlMatch = html.match(/src="?([^"\s]+)"?\s*/);
        if (!urlMatch) {
          throw new Error("Unable to find image source");
        }
        const url = urlMatch[1].replace("&amp;", "&"); // Reverse html encoding of url parameters
        let name = "";
        const altMatch = html.match(/alt="?([^"]+)"?\s*/);
        if (altMatch && altMatch.length > 1) {
          name = altMatch[1];
        }
        const response = await fetch(url);
        if (response.ok) {
          const blob = await response.blob();
          const file = new File([blob], name, {
            type: blob.type,
          });
          if (supportFileTypes.includes(file.type)) {
            imageFiles.push(file);
          } else {
            addToast(`Unsupported file type for ${file.name}`);
          }
        }
      } catch (e) {
        if (e instanceof Error) {
          if (e.message === "Failed to fetch") {
            addToast("Unable to import image: failed to fetch");
          } else {
            addToast("Unable to import image");
          }
        }
      }
    }

    const files = event.dataTransfer?.files || [];
    let otherFiles = [];
    for (let file of files) {
      if (supportFileTypes.includes(file.type)) {
        imageFiles.push(file);
      } else {
        otherFiles.push(file);
      }
    }
    if (onOtherFiles) {
      otherFiles = onOtherFiles(otherFiles);
    }
    for (let file of otherFiles) {
      addToast(`Unsupported file type for ${file.name}`);
    }
    // Nothing to do when only other files were dropped
    if (imageFiles.length > 0 || !onOtherFiles) {
      onImageDrop({ files: imageFiles, dropPosition });
    }
    setDragging(false);
  }

  const containerListeners = { onDragEnter };
  const overlayListeners = { onDragLeave, onDragOver, onDrop };

  return {
    dragging,
    draggingOther,
    draggingMonster,
    containerListeners,
    overlayListeners,
  };
}

export default useImageDrop;
