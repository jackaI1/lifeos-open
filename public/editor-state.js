export function createEditorState(date) {
  return { activeDate: date, entry: null, revision: 0, loadToken: 0, generation: 0, editId: 0 };
}

export function beginLoad(state) {
  state.loadToken += 1;
  return state.loadToken;
}

export function finishLoad(state, token, entry) {
  if (token !== state.loadToken) return false;
  state.activeDate = entry.date;
  state.entry = structuredClone(entry);
  state.revision = 0;
  state.generation += 1;
  return true;
}

export function failLoad(state, token) {
  return token === state.loadToken;
}

export function editEntry(state, points, complete) {
  state.entry = { ...state.entry, points: [...points], complete };
  state.revision += 1;
  state.editId += 1;
}

export function beginSave(state) {
  return {
    date: state.activeDate,
    revision: state.revision,
    generation: state.generation,
    editId: state.editId,
    entry: structuredClone(state.entry)
  };
}

export function finishSave(state, snapshot, saved) {
  if (state.activeDate !== snapshot.date || !state.entry || state.generation !== snapshot.generation) return "different-entry";
  if (state.editId === snapshot.editId) {
    state.entry = structuredClone(saved);
    return "clean";
  }
  state.entry.version = saved.version;
  state.entry.updatedAt = saved.updatedAt;
  return "edited-during-save";
}
