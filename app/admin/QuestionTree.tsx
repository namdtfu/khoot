"use client";

import { DragEvent, useMemo, useState } from "react";
import styles from "./admin.module.css";

export type TreeFolder = {
  id: string;
  parent_id: string | null;
  name: string;
  position: number;
};

export type TreeQuestionSet = {
  id: string;
  folder_id: string | null;
  title: string;
  topic: string;
  is_published: boolean;
  position: number;
};

type DragItem = {
  type: "folder" | "set";
  id: string;
};

type QuestionTreeProps = {
  folders: TreeFolder[];
  sets: TreeQuestionSet[];
  selectedFolderId: string | null;
  selectedSetId: string | null;
  busy: boolean;
  onSelectFolder: (folderId: string) => void;
  onSelectSet: (setId: string) => void;
  onMoveFolder: (folderId: string, parentId: string | null, position: number) => void;
  onMoveSet: (setId: string, folderId: string | null, position: number) => void;
};

const ROOT_KEY = "__root__";
const DRAG_TYPE = "application/x-khoot-tree-item";

function parentKey(parentId: string | null) {
  return parentId ?? ROOT_KEY;
}

function writeDragItem(event: DragEvent, item: DragItem) {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(item));
}

function readDragItem(event: DragEvent): DragItem | null {
  try {
    const item = JSON.parse(event.dataTransfer.getData(DRAG_TYPE)) as DragItem;
    return item.type === "folder" || item.type === "set" ? item : null;
  } catch {
    return null;
  }
}

export default function QuestionTree({
  folders,
  sets,
  selectedFolderId,
  selectedSetId,
  busy,
  onSelectFolder,
  onSelectSet,
  onMoveFolder,
  onMoveSet,
}: QuestionTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const groupedFolders = useMemo(() => {
    const grouped = new Map<string, TreeFolder[]>();
    for (const folder of folders) {
      const key = parentKey(folder.parent_id);
      grouped.set(key, [...(grouped.get(key) ?? []), folder]);
    }
    for (const children of grouped.values()) {
      children.sort((left, right) => left.position - right.position || left.name.localeCompare(right.name, "vi"));
    }
    return grouped;
  }, [folders]);
  const groupedSets = useMemo(() => {
    const grouped = new Map<string, TreeQuestionSet[]>();
    for (const questionSet of sets) {
      const key = parentKey(questionSet.folder_id);
      grouped.set(key, [...(grouped.get(key) ?? []), questionSet]);
    }
    for (const children of grouped.values()) {
      children.sort((left, right) => left.position - right.position || left.title.localeCompare(right.title, "vi"));
    }
    return grouped;
  }, [sets]);

  const toggleFolder = (folderId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const allowDrop = (event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const moveInto = (event: DragEvent, folderId: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    const item = readDragItem(event);
    if (!item) return;
    if (item.type === "set") {
      onMoveSet(item.id, folderId, groupedSets.get(parentKey(folderId))?.length ?? 0);
    } else {
      onMoveFolder(item.id, folderId, groupedFolders.get(parentKey(folderId))?.length ?? 0);
    }
  };

  const renderSet = (questionSet: TreeQuestionSet, siblings: TreeQuestionSet[], depth: number) => {
    const siblingIndex = siblings.findIndex((item) => item.id === questionSet.id);
    return (
      <div
        className={`${styles.treeSetRow} ${selectedSetId === questionSet.id ? styles.treeSelected : ""}`}
        key={questionSet.id}
        style={{ paddingLeft: `${10 + depth * 15}px` }}
        draggable={!busy}
        onDragStart={(event) => writeDragItem(event, { type: "set", id: questionSet.id })}
        onDragOver={allowDrop}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const item = readDragItem(event);
          if (item?.type === "set") onMoveSet(item.id, questionSet.folder_id, siblingIndex);
        }}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={selectedSetId === questionSet.id}
      >
        <button className={styles.treeMainButton} onClick={() => onSelectSet(questionSet.id)} type="button">
          <span className={styles.treeSetIcon}>◆</span>
          <span className={styles.treeItemCopy}>
            <strong>{questionSet.title}</strong>
            <small>{questionSet.topic}</small>
          </span>
          <i className={questionSet.is_published ? styles.publishedDot : ""} />
        </button>
        <span className={styles.treeOrderButtons}>
          <button
            type="button"
            aria-label={`Đưa ${questionSet.title} lên trên`}
            disabled={busy || siblingIndex === 0}
            onClick={() => onMoveSet(questionSet.id, questionSet.folder_id, siblingIndex - 1)}
          >↑</button>
          <button
            type="button"
            aria-label={`Đưa ${questionSet.title} xuống dưới`}
            disabled={busy || siblingIndex === siblings.length - 1}
            onClick={() => onMoveSet(questionSet.id, questionSet.folder_id, siblingIndex + 1)}
          >↓</button>
        </span>
      </div>
    );
  };

  const renderFolder = (folder: TreeFolder, siblings: TreeFolder[], depth: number) => {
    const childFolders = groupedFolders.get(parentKey(folder.id)) ?? [];
    const childSets = groupedSets.get(parentKey(folder.id)) ?? [];
    const siblingIndex = siblings.findIndex((item) => item.id === folder.id);
    const isCollapsed = collapsed.has(folder.id);

    return (
      <div
        className={styles.treeFolderBranch}
        key={folder.id}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={!isCollapsed}
        aria-selected={selectedFolderId === folder.id}
      >
        <div
          className={`${styles.treeFolderRow} ${selectedFolderId === folder.id ? styles.treeSelected : ""}`}
          style={{ paddingLeft: `${8 + depth * 15}px` }}
          draggable={!busy}
          onDragStart={(event) => writeDragItem(event, { type: "folder", id: folder.id })}
          onDragOver={allowDrop}
          onDrop={(event) => moveInto(event, folder.id)}
        >
          <button className={styles.treeToggle} type="button" onClick={() => toggleFolder(folder.id)} aria-label={isCollapsed ? "Mở thư mục" : "Thu gọn thư mục"}>
            {isCollapsed ? "▸" : "▾"}
          </button>
          <button className={styles.treeMainButton} onClick={() => onSelectFolder(folder.id)} type="button">
            <span className={styles.treeFolderIcon}>{isCollapsed ? "▰" : "▱"}</span>
            <span className={styles.treeItemCopy}>
              <strong>{folder.name}</strong>
              <small>{childFolders.length + childSets.length} mục</small>
            </span>
          </button>
          <span className={styles.treeOrderButtons}>
            <button
              type="button"
              aria-label={`Đưa thư mục ${folder.name} lên trên`}
              disabled={busy || siblingIndex === 0}
              onClick={() => onMoveFolder(folder.id, folder.parent_id, siblingIndex - 1)}
            >↑</button>
            <button
              type="button"
              aria-label={`Đưa thư mục ${folder.name} xuống dưới`}
              disabled={busy || siblingIndex === siblings.length - 1}
              onClick={() => onMoveFolder(folder.id, folder.parent_id, siblingIndex + 1)}
            >↓</button>
          </span>
        </div>
        {!isCollapsed && (
          <div role="group">
            {childFolders.map((child) => renderFolder(child, childFolders, depth + 1))}
            {childSets.map((questionSet) => renderSet(questionSet, childSets, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const rootFolders = groupedFolders.get(ROOT_KEY) ?? [];
  const rootSets = groupedSets.get(ROOT_KEY) ?? [];

  return (
    <div className={styles.questionTree} role="tree" aria-label="Cây thư mục bộ đề">
      <div className={styles.treeRootDrop} onDragOver={allowDrop} onDrop={(event) => moveInto(event, null)}>
        <span>⌂</span>
        <strong>Gốc</strong>
        <small>Thả vào đây để đưa ra ngoài thư mục</small>
      </div>
      {rootFolders.map((folder) => renderFolder(folder, rootFolders, 0))}
      {rootSets.map((questionSet) => renderSet(questionSet, rootSets, 0))}
      {!folders.length && !sets.length && <p className={styles.treeEmpty}>Chưa có thư mục hoặc bộ đề.</p>}
    </div>
  );
}
