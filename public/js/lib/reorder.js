/**
 * Pointer-based drag-to-reorder for a flat row of sibling elements.
 *
 * Each reorderable child must carry `data-id` and contain an element with
 * the `.drag-handle` class (press-and-drag that handle, not the whole card,
 * so a tap still opens the meter). Works the same for a one-column list and
 * a multi-column grid, with touch, mouse and pen pointers alike.
 */
export function enableReorder(container, onReorder) {
  let dragEl = null;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let moved = false;

  function siblings() {
    return [...container.children].filter((el) => el.dataset.id);
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const handle = event.target.closest('.drag-handle');
    if (!handle) return;
    const item = handle.closest('[data-id]');
    if (!item || item.parentElement !== container) return;
    dragEl = item;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    moved = false;
    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
  }

  function onPointerMove(event) {
    if (!dragEl) return;
    if (!moved && Math.hypot(event.clientX - startX, event.clientY - startY) < 8) return;
    event.preventDefault();
    if (!moved) {
      moved = true;
      dragEl.classList.add('dragging');
      container.classList.add('reordering');
    }
    const under = document
      .elementsFromPoint(event.clientX, event.clientY)
      .find((el) => el !== dragEl && el.closest('[data-id]')?.parentElement === container);
    const targetItem = under ? under.closest('[data-id]') : null;
    if (!targetItem || targetItem === dragEl) return;
    const items = siblings();
    const dragIndex = items.indexOf(dragEl);
    const targetIndex = items.indexOf(targetItem);
    container.insertBefore(dragEl, targetIndex < dragIndex ? targetItem : targetItem.nextSibling);
  }

  function onPointerUp() {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerUp);
    if (dragEl) {
      dragEl.classList.remove('dragging');
      container.classList.remove('reordering');
      if (moved) onReorder(siblings().map((el) => el.dataset.id));
    }
    dragEl = null;
    pointerId = null;
    moved = false;
  }

  container.addEventListener('pointerdown', onPointerDown);
  return () => container.removeEventListener('pointerdown', onPointerDown);
}
