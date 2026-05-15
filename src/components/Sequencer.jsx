import { useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';

const STEPS = 16;
const INITIAL_BPM = 116;
const SAMPLE_RATE = 44100;
const MP3_BIT_RATE = 128;
const ATTACK_SECONDS = 0.005;
const RELEASE_SECONDS = 0.025;
const MIN_BPM = 60;
const MAX_BPM = 180;

const noteRows = [
  'C6',
  'B5',
  'A5',
  'G5',
  'F5',
  'E5',
  'D5',
  'C5',
  'B4',
  'A4',
  'G4',
  'F4',
  'E4',
  'D4',
  'C4',
  'C3'
];

const stepIndexes = Array.from({ length: STEPS }, (_, index) => index);

const createEmptyGrid = () =>
  Array.from({ length: noteRows.length }, () => Array(STEPS).fill(false));

let mp3EncoderConstructor = null;

const loadMp3Encoder = async () => {
  if (mp3EncoderConstructor) {
    return mp3EncoderConstructor;
  }

  const lameBundle = await import('lamejs/lame.all.js?raw');
  const lame = new Function(`${lameBundle.default}\nreturn lamejs;`)();
  mp3EncoderConstructor = lame.Mp3Encoder;

  return mp3EncoderConstructor;
};

const cloneGrid = (gridToClone) => gridToClone.map((row) => [...row]);

const cloneItems = (items) =>
  items.map((item) => ({ id: crypto.randomUUID(), loopId: item.loopId }));

const getTodayFileDate = () => new Date().toISOString().slice(0, 10);

const countBits = (gridToCount) =>
  gridToCount.reduce(
    (total, row) => total + row.filter((isActive) => isActive).length,
    0
  );

const noteToFrequency = (note) => {
  const [, pitch, accidental = '', octaveText] =
    note.match(/^([A-G])([#b]?)(\d)$/) ?? [];
  const semitones = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11
  };
  const accidentalOffset = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  const midiNumber =
    (Number(octaveText) + 1) * 12 + semitones[pitch] + accidentalOffset;

  return 440 * 2 ** ((midiNumber - 69) / 12);
};

const reorderItems = (items, fromIndex, toIndex) => {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex > items.length
  ) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);

  return nextItems;
};

const reorderItemsFromDrop = (items, fromIndex, dropIndex) => {
  if (
    fromIndex < 0 ||
    dropIndex < 0 ||
    fromIndex >= items.length ||
    dropIndex > items.length ||
    fromIndex === dropIndex
  ) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  const adjustedDropIndex =
    fromIndex < dropIndex ? Math.max(0, dropIndex - 1) : dropIndex;
  nextItems.splice(adjustedDropIndex, 0, movedItem);

  return nextItems;
};

const getDropIndexFromPointer = (container, clientY, itemSelector) => {
  const items = Array.from(container.querySelectorAll(itemSelector));
  const hoveredIndex = items.findIndex((item) => {
    const rect = item.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });

  return hoveredIndex === -1 ? items.length : hoveredIndex;
};

const renderLoopsToMp3 = async (loops, bpm) => {
  const Mp3Encoder = await loadMp3Encoder();
  const stepSeconds = 60 / bpm / 4;
  const noteSeconds = stepSeconds * 0.92;
  const totalSteps = loops.length * STEPS;
  const totalSamples = Math.ceil(totalSteps * stepSeconds * SAMPLE_RATE);
  const samples = new Float32Array(totalSamples + SAMPLE_RATE * 0.1);

  loops.forEach((loop, loopIndex) => {
    loop.grid.forEach((row, rowIndex) => {
      row.forEach((isActive, stepIndex) => {
        if (!isActive) {
          return;
        }

        const frequency = noteToFrequency(noteRows[rowIndex]);
        const startSample = Math.floor(
          (loopIndex * STEPS + stepIndex) * stepSeconds * SAMPLE_RATE
        );
        const noteSamples = Math.floor(noteSeconds * SAMPLE_RATE);

        for (let i = 0; i < noteSamples; i += 1) {
          const sampleIndex = startSample + i;
          const time = i / SAMPLE_RATE;
          const attack = Math.min(1, time / ATTACK_SECONDS);
          const release =
            time > noteSeconds - RELEASE_SECONDS
              ? Math.max(0, (noteSeconds - time) / RELEASE_SECONDS)
              : 1;
          const envelope = attack * release;
          const square = Math.sin(2 * Math.PI * frequency * time) >= 0 ? 1 : -1;

          samples[sampleIndex] += square * envelope * 0.09;
        }
      });
    });
  });

  let peak = 0;
  samples.forEach((sample) => {
    peak = Math.max(peak, Math.abs(sample));
  });

  const gain = peak > 0 ? 0.9 / peak : 1;
  const pcm = new Int16Array(samples.length);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample * gain));
    pcm[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  });

  const encoder = new Mp3Encoder(1, SAMPLE_RATE, MP3_BIT_RATE);
  const chunks = [];
  const blockSize = 1152;

  for (let start = 0; start < pcm.length; start += blockSize) {
    const block = pcm.subarray(start, start + blockSize);
    const mp3Buffer = encoder.encodeBuffer(block);

    if (mp3Buffer.length > 0) {
      chunks.push(mp3Buffer);
    }
  }

  const finalBuffer = encoder.flush();

  if (finalBuffer.length > 0) {
    chunks.push(finalBuffer);
  }

  return new Blob(chunks, { type: 'audio/mpeg' });
};

export default function Sequencer() {
  const [grid, setGrid] = useState(createEmptyGrid);
  const [editingLoopId, setEditingLoopId] = useState(null);
  const [savedLoops, setSavedLoops] = useState([]);
  const [arrangement, setArrangement] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [activeDraftId, setActiveDraftId] = useState(null);
  const [bpm, setBpm] = useState(INITIAL_BPM);
  const [playbackMode, setPlaybackMode] = useState(null);
  const [activeStep, setActiveStep] = useState(-1);
  const [activeSequenceIndex, setActiveSequenceIndex] = useState(-1);
  const [previewGrid, setPreviewGrid] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [draggedLoopId, setDraggedLoopId] = useState(null);
  const [draggedArrangeIndex, setDraggedArrangeIndex] = useState(null);
  const [draggedDraftIndex, setDraggedDraftIndex] = useState(null);
  const [arrangementDropIndex, setArrangementDropIndex] = useState(null);
  const [draftDropIndex, setDraftDropIndex] = useState(null);
  const gridRef = useRef(grid);
  const bpmRef = useRef(bpm);
  const synthRef = useRef(null);
  const sequenceRef = useRef(null);
  const playbackSessionRef = useRef(0);

  const activeDraft = useMemo(
    () => drafts.find((draft) => draft.id === activeDraftId) ?? null,
    [activeDraftId, drafts]
  );

  const resolveItems = (items) =>
    items
      .map((item) => savedLoops.find((loop) => loop.id === item.loopId))
      .filter(Boolean);

  const arrangedLoops = useMemo(
    () => resolveItems(arrangement),
    [arrangement, savedLoops]
  );

  const draftLoops = useMemo(
    () => (activeDraft ? resolveItems(activeDraft.items) : []),
    [activeDraft, savedLoops]
  );

  const editingLoop = savedLoops.find((loop) => loop.id === editingLoopId);
  const isPlayingLoop = playbackMode === 'loop';
  const isPlayingArrangement = playbackMode === 'arrangement';
  const isPlayingDraft = playbackMode === 'draft';
  const isPlaying = Boolean(playbackMode);
  const displayedGrid = isPlaying ? previewGrid ?? grid : grid;

  useEffect(() => {
    gridRef.current = grid;
  }, [grid]);

  useEffect(() => {
    bpmRef.current = bpm;
    Tone.Transport.bpm.value = bpm;
  }, [bpm]);

  useEffect(() => {
    synthRef.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'square' },
      envelope: {
        attack: 0.005,
        decay: 0.08,
        sustain: 0.12,
        release: 0.08
      }
    }).toDestination();

    Tone.Transport.bpm.value = INITIAL_BPM;

    return () => {
      sequenceRef.current?.dispose();
      synthRef.current?.dispose();
      Tone.Transport.stop();
      Tone.Transport.cancel();
    };
  }, []);

  const stopPlayback = (message = 'Playback stopped') => {
    playbackSessionRef.current += 1;
    sequenceRef.current?.stop();
    sequenceRef.current?.dispose();
    sequenceRef.current = null;
    Tone.Transport.stop();
    Tone.Transport.cancel();
    Tone.Transport.position = 0;
    setActiveStep(-1);
    setActiveSequenceIndex(-1);
    setPreviewGrid(null);
    setPlaybackMode(null);
    setStatusMessage(message);
  };

  const startPlayback = async (loops, mode) => {
    await Tone.start();

    const playbackSession = playbackSessionRef.current + 1;
    playbackSessionRef.current = playbackSession;
    sequenceRef.current?.dispose();
    Tone.Transport.stop();
    Tone.Transport.cancel();
    Tone.Transport.position = 0;
    Tone.Transport.bpm.value = bpmRef.current;

    const playbackLoops = loops.map((loop) => ({
      ...loop,
      grid: cloneGrid(loop.grid)
    }));

    sequenceRef.current = new Tone.Sequence(
      (time, globalStep) => {
        const loopIndex = Math.floor(globalStep / STEPS);
        const step = globalStep % STEPS;
        const loop = playbackLoops[loopIndex];
        const notes = loop.grid
          .map((row, rowIndex) => (row[step] ? noteRows[rowIndex] : null))
          .filter(Boolean);

        if (notes.length > 0) {
          synthRef.current.triggerAttackRelease(notes, '16n', time);
        }

        Tone.Draw.schedule(() => {
          if (playbackSessionRef.current !== playbackSession) {
            return;
          }

          setActiveStep(step);
          setActiveSequenceIndex(mode === 'loop' ? -1 : loopIndex);
          setPreviewGrid(loop.grid);
        }, time);
      },
      Array.from({ length: playbackLoops.length * STEPS }, (_, index) => index),
      '16n'
    );
    sequenceRef.current.loop = true;
    sequenceRef.current.start(0);
    Tone.Transport.start();

    setActiveStep(0);
    setActiveSequenceIndex(mode === 'loop' ? -1 : 0);
    setPreviewGrid(playbackLoops[0].grid);
    setPlaybackMode(mode);
    setStatusMessage(
      mode === 'arrangement'
        ? 'Playing arrangement'
        : mode === 'draft'
          ? 'Playing draft'
          : 'Playing editor loop'
    );
  };

  const handleLoopPlayback = async () => {
    if (isPlayingLoop) {
      stopPlayback('Loop stopped');
      return;
    }

    await startPlayback(
      [{ id: 'editor', name: 'Editor Loop', grid: cloneGrid(gridRef.current) }],
      'loop'
    );
  };

  const handleArrangementPlayback = async () => {
    if (isPlayingArrangement) {
      stopPlayback('Arrangement stopped');
      return;
    }

    if (arrangedLoops.length === 0) {
      setStatusMessage('Add loops to arrangement first');
      return;
    }

    await startPlayback(arrangedLoops, 'arrangement');
  };

  const handleDraftPlayback = async () => {
    if (isPlayingDraft) {
      stopPlayback('Draft stopped');
      return;
    }

    if (draftLoops.length === 0) {
      setStatusMessage('Open a draft with loops first');
      return;
    }

    await startPlayback(draftLoops, 'draft');
  };

  const updateLoadedLoop = (nextGrid) => {
    if (!editingLoopId) {
      return;
    }

    setSavedLoops((currentLoops) =>
      currentLoops.map((loop) =>
        loop.id === editingLoopId ? { ...loop, grid: cloneGrid(nextGrid) } : loop
      )
    );
  };

  const toggleBit = (rowIndex, stepIndex) => {
    setGrid((currentGrid) => {
      const nextGrid = currentGrid.map((row, r) =>
        r === rowIndex
          ? row.map((isActive, s) => (s === stepIndex ? !isActive : isActive))
          : row
      );

      updateLoadedLoop(nextGrid);
      return nextGrid;
    });
  };

  const clearGrid = () => {
    if (isPlaying) {
      stopPlayback('Editor cleared');
    }

    setGrid(createEmptyGrid());
    setEditingLoopId(null);
    setPreviewGrid(null);
    setActiveStep(-1);
    setActiveSequenceIndex(-1);
    setPlaybackMode(null);
    setStatusMessage('Editor cleared');
  };

  const saveLoop = () => {
    const nextNumber =
      savedLoops.reduce((highestNumber, loop) => {
        const loopNumber = Number(loop.name.match(/\d+$/)?.[0] ?? 0);
        return Math.max(highestNumber, loopNumber);
      }, 0) + 1;
    const newLoop = {
      id: crypto.randomUUID(),
      name: `Loop ${nextNumber}`,
      grid: cloneGrid(grid)
    };

    setSavedLoops((currentLoops) => [...currentLoops, newLoop]);
    setEditingLoopId(newLoop.id);
    setStatusMessage(`${newLoop.name} saved to library`);
  };

  const loadLoop = (loop) => {
    if (isPlaying) {
      stopPlayback(`${loop.name} loaded into editor`);
    }

    setGrid(cloneGrid(loop.grid));
    setEditingLoopId(loop.id);
    setPreviewGrid(null);
    setStatusMessage(`${loop.name} loaded. Edits auto-save.`);
  };

  const deleteLoop = (loopId) => {
    setSavedLoops((currentLoops) =>
      currentLoops.filter((loop) => loop.id !== loopId)
    );
    setArrangement((currentArrangement) =>
      currentArrangement.filter((item) => item.loopId !== loopId)
    );
    setDrafts((currentDrafts) =>
      currentDrafts.map((draft) => ({
        ...draft,
        items: draft.items.filter((item) => item.loopId !== loopId)
      }))
    );

    if (editingLoopId === loopId) {
      clearGrid();
    } else {
      setStatusMessage('Loop deleted');
    }
  };

  const renameLoop = (loopId, nextName) => {
    const cleanName = nextName.trim();

    if (!cleanName) {
      return;
    }

    setSavedLoops((currentLoops) =>
      currentLoops.map((loop) =>
        loop.id === loopId ? { ...loop, name: cleanName } : loop
      )
    );
    setStatusMessage(`Renamed to ${cleanName}`);
  };

  const addLoopToArrangement = (loopId, insertIndex = arrangement.length) => {
    const loop = savedLoops.find((savedLoop) => savedLoop.id === loopId);

    if (!loop) {
      return;
    }

    setArrangement((currentArrangement) => {
      const nextArrangement = [...currentArrangement];
      nextArrangement.splice(insertIndex, 0, {
        id: crypto.randomUUID(),
        loopId
      });
      return nextArrangement;
    });
    setStatusMessage(`${loop.name} added to arrangement`);
  };

  const removeArrangementItem = (itemId) => {
    setArrangement((currentArrangement) =>
      currentArrangement.filter((item) => item.id !== itemId)
    );
    setStatusMessage('Removed from arrangement');
  };

  const moveArrangementItem = (itemIndex, direction) => {
    setArrangement((currentArrangement) =>
      reorderItems(currentArrangement, itemIndex, itemIndex + direction)
    );
  };

  const addDraft = () => {
    if (arrangement.length === 0) {
      setStatusMessage('Build an arrangement before saving a draft');
      return;
    }

    const nextNumber =
      drafts.reduce((highestNumber, draft) => {
        const draftNumber = Number(draft.name.match(/\d+$/)?.[0] ?? 0);
        return Math.max(highestNumber, draftNumber);
      }, 0) + 1;
    const newDraft = {
      id: crypto.randomUUID(),
      name: `Draft ${nextNumber}`,
      items: cloneItems(arrangement)
    };

    setDrafts((currentDrafts) => [...currentDrafts, newDraft]);
    setActiveDraftId(newDraft.id);
    setStatusMessage(`${newDraft.name} saved`);
  };

  const deleteDraft = (draftId) => {
    setDrafts((currentDrafts) =>
      currentDrafts.filter((draft) => draft.id !== draftId)
    );

    if (activeDraftId === draftId) {
      setActiveDraftId(null);
    }

    setStatusMessage('Draft deleted');
  };

  const renameDraft = (draftId, nextName) => {
    const cleanName = nextName.trim();

    if (!cleanName) {
      return;
    }

    setDrafts((currentDrafts) =>
      currentDrafts.map((draft) =>
        draft.id === draftId ? { ...draft, name: cleanName } : draft
      )
    );
    setStatusMessage(`Renamed to ${cleanName}`);
  };

  const addDraftToArrangement = (draft = activeDraft) => {
    if (!draft || draft.items.length === 0) {
      setStatusMessage('Open a draft with loops first');
      return;
    }

    setArrangement((currentArrangement) => [
      ...currentArrangement,
      ...cloneItems(draft.items)
    ]);
    setStatusMessage(`${draft.name} added to arrangement`);
  };

  const addLoopToDraft = (loopId, insertIndex = activeDraft?.items.length ?? 0) => {
    if (!activeDraft) {
      setStatusMessage('Open a draft first');
      return;
    }

    const loop = savedLoops.find((savedLoop) => savedLoop.id === loopId);

    if (!loop) {
      return;
    }

    setDrafts((currentDrafts) =>
      currentDrafts.map((draft) => {
        if (draft.id !== activeDraft.id) {
          return draft;
        }

        const nextItems = [...draft.items];
        nextItems.splice(insertIndex, 0, {
          id: crypto.randomUUID(),
          loopId
        });

        return { ...draft, items: nextItems };
      })
    );
    setStatusMessage(`${loop.name} added to ${activeDraft.name}`);
  };

  const removeDraftItem = (itemId) => {
    if (!activeDraft) {
      return;
    }

    setDrafts((currentDrafts) =>
      currentDrafts.map((draft) =>
        draft.id === activeDraft.id
          ? { ...draft, items: draft.items.filter((item) => item.id !== itemId) }
          : draft
      )
    );
    setStatusMessage('Removed from draft');
  };

  const moveDraftItem = (itemIndex, direction) => {
    if (!activeDraft) {
      return;
    }

    setDrafts((currentDrafts) =>
      currentDrafts.map((draft) =>
        draft.id === activeDraft.id
          ? {
              ...draft,
              items: reorderItems(draft.items, itemIndex, itemIndex + direction)
            }
          : draft
      )
    );
  };

  const handleArrangementDrop = (event, dropIndex = arrangement.length) => {
    event.preventDefault();
    event.stopPropagation();
    const loopId = event.dataTransfer.getData('loop-id') || draggedLoopId;
    const arrangementIndexText =
      event.dataTransfer.getData('arrangement-index') ?? '';
    const arrangementIndex =
      arrangementIndexText === '' ? draggedArrangeIndex : Number(arrangementIndexText);

    if (loopId) {
      addLoopToArrangement(loopId, dropIndex);
    } else if (Number.isInteger(arrangementIndex)) {
      setArrangement((currentArrangement) =>
        reorderItemsFromDrop(currentArrangement, arrangementIndex, dropIndex)
      );
    }

    setDraggedLoopId(null);
    setDraggedArrangeIndex(null);
    setDraggedDraftIndex(null);
    setArrangementDropIndex(null);
  };

  const clearDragState = () => {
    setDraggedLoopId(null);
    setDraggedArrangeIndex(null);
    setDraggedDraftIndex(null);
    setArrangementDropIndex(null);
    setDraftDropIndex(null);
  };

  const handleArrangementDragOver = (event) => {
    event.preventDefault();
    const dropIndex = getDropIndexFromPointer(
      event.currentTarget,
      event.clientY,
      '[data-arrangement-item]'
    );
    const isNoopMove =
      Number.isInteger(draggedArrangeIndex) &&
      (dropIndex === draggedArrangeIndex || dropIndex === draggedArrangeIndex + 1);
    setArrangementDropIndex(isNoopMove ? null : dropIndex);
  };

  const handleArrangementContainerDrop = (event) => {
    const dropIndex =
      arrangementDropIndex ??
      getDropIndexFromPointer(
        event.currentTarget,
        event.clientY,
        '[data-arrangement-item]'
      );
    handleArrangementDrop(event, dropIndex);
  };

  const handleDraftDrop = (event, dropIndex = activeDraft?.items.length ?? 0) => {
    event.preventDefault();
    event.stopPropagation();
    const loopId = event.dataTransfer.getData('loop-id') || draggedLoopId;
    const draftIndexText = event.dataTransfer.getData('draft-index') ?? '';
    const draftIndex =
      draftIndexText === '' ? draggedDraftIndex : Number(draftIndexText);

    if (loopId) {
      addLoopToDraft(loopId, dropIndex);
    } else if (Number.isInteger(draftIndex) && activeDraft) {
      setDrafts((currentDrafts) =>
        currentDrafts.map((draft) =>
          draft.id === activeDraft.id
            ? {
                ...draft,
                items: reorderItemsFromDrop(draft.items, draftIndex, dropIndex)
              }
            : draft
        )
      );
    }

    setDraggedLoopId(null);
    setDraggedArrangeIndex(null);
    setDraggedDraftIndex(null);
    setDraftDropIndex(null);
  };

  const handleDraftDragOver = (event) => {
    event.preventDefault();
    const dropIndex = getDropIndexFromPointer(
      event.currentTarget,
      event.clientY,
      '[data-draft-item]'
    );
    const isNoopMove =
      Number.isInteger(draggedDraftIndex) &&
      (dropIndex === draggedDraftIndex || dropIndex === draggedDraftIndex + 1);
    setDraftDropIndex(isNoopMove ? null : dropIndex);
  };

  const handleDraftContainerDrop = (event) => {
    const dropIndex =
      draftDropIndex ??
      getDropIndexFromPointer(event.currentTarget, event.clientY, '[data-draft-item]');
    handleDraftDrop(event, dropIndex);
  };

  const downloadMp3 = async () => {
    if (arrangedLoops.length === 0 || isExporting) {
      return;
    }

    setIsExporting(true);
    setStatusMessage('Rendering MP3...');

    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const blob = await renderLoopsToMp3(arrangedLoops, bpm);
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = downloadUrl;
      link.download = `bit-bot-jukebox_${getTodayFileDate()}.mp3`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
      setStatusMessage(`Exported ${arrangedLoops.length} arranged loops`);
    } catch (error) {
      console.error(error);
      setStatusMessage(
        `MP3 export failed: ${error instanceof Error ? error.message : 'try again'}`
      );
    } finally {
      setIsExporting(false);
    }
  };

  const playingName =
    playbackMode === 'arrangement'
      ? arrangedLoops[activeSequenceIndex]?.name
      : playbackMode === 'draft'
        ? draftLoops[activeSequenceIndex]?.name
        : 'editor loop';

  return (
    <section className="flex flex-1 flex-col gap-5">
      <div className="font-mono text-xs text-[#c4c4a4]">
        {editingLoop
          ? `Editing ${editingLoop.name}. Changes auto-save.`
          : 'Editing a new unsaved loop.'}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.85fr)_minmax(360px,0.95fr)]">
        <Panel title="Loop Library">
          {savedLoops.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {savedLoops.map((loop) => (
                <LoopCard
                  key={loop.id}
                  loop={loop}
                  isEditing={loop.id === editingLoopId}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('loop-id', loop.id);
                    event.dataTransfer.effectAllowed = 'copy';
                    setDraggedLoopId(loop.id);
                    setDraggedArrangeIndex(null);
                    setDraggedDraftIndex(null);
                  }}
                  onDragEnd={clearDragState}
                  onAdd={() => addLoopToArrangement(loop.id)}
                  onLoad={() => loadLoop(loop)}
                  onRename={(nextName) => renameLoop(loop.id, nextName)}
                  onDelete={() => deleteLoop(loop.id)}
                />
              ))}
            </div>
          ) : (
            <EmptyState text="Save a 16-step loop to build your library." />
          )}
        </Panel>

        <Panel title="Drafts">
          <button
            type="button"
            onClick={addDraft}
            className="mb-3 w-full border-4 border-[#101828] bg-[#ffe66d] px-4 py-3 font-pixel text-xs uppercase leading-none text-[#101828] transition hover:bg-[#fff08f]"
          >
            Add Draft
          </button>

          {drafts.length > 0 ? (
            <div className="flex flex-col gap-2">
              {drafts.map((draft) => (
                <DraftCard
                  key={draft.id}
                  draft={draft}
                  isActive={draft.id === activeDraftId}
                  onOpen={() => setActiveDraftId(draft.id)}
                  onAdd={() => addDraftToArrangement(draft)}
                  onRename={(nextName) => renameDraft(draft.id, nextName)}
                  onDelete={() => deleteDraft(draft.id)}
                />
              ))}
            </div>
          ) : (
            <EmptyState text="Arrange loops, then save that order as a draft." />
          )}

          <div className="mt-4 border-t-2 border-[#f7f7df] pt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-pixel text-xs leading-relaxed text-[#65e4a3]">
                Draft Editor
              </h3>
              <button
                type="button"
                onClick={handleDraftPlayback}
                disabled={draftLoops.length === 0 && !isPlayingDraft}
                className="border-2 border-[#4cc9f0] px-3 py-2 font-mono text-xs text-[#4cc9f0] transition hover:bg-[#4cc9f0] hover:text-[#101828] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isPlayingDraft ? 'Stop Draft' : 'Play Draft'}
              </button>
            </div>

            {activeDraft ? (
              <>
                <div
                  onDragOver={handleDraftDragOver}
                  onDrop={handleDraftContainerDrop}
                  onDragLeave={(event) => {
                    if (event.currentTarget === event.target) {
                      setDraftDropIndex(null);
                    }
                  }}
                  className="flex min-h-[120px] flex-col gap-2 border-2 border-dashed border-[#65e4a3] bg-[#18251f] p-3"
                >
                  {activeDraft.items.length > 0 ? (
                    <>
                      {activeDraft.items.map((item, index) => {
                        const loop = savedLoops.find(
                          (savedLoop) => savedLoop.id === item.loopId
                        );

                        if (!loop) {
                          return null;
                        }

                        return (
                          <div key={item.id} className="flex flex-col gap-2">
                            <InsertionZone
                              isActive={draftDropIndex === index}
                            />
                            <SequenceItem
                              itemType="draft"
                              index={index}
                              loop={loop}
                              isActive={isPlayingDraft && activeSequenceIndex === index}
                              onDragStart={(event) => {
                                event.dataTransfer.setData('draft-index', String(index));
                                event.dataTransfer.effectAllowed = 'move';
                                setDraggedLoopId(null);
                                setDraggedArrangeIndex(null);
                                setDraggedDraftIndex(index);
                              }}
                              onDragEnd={clearDragState}
                              onEdit={() => loadLoop(loop)}
                              onMoveUp={() => moveDraftItem(index, -1)}
                              onMoveDown={() => moveDraftItem(index, 1)}
                              onRemove={() => removeDraftItem(item.id)}
                              disableUp={index === 0}
                              disableDown={index === activeDraft.items.length - 1}
                            />
                          </div>
                        );
                      })}
                      <InsertionZone
                        isActive={draftDropIndex === activeDraft.items.length}
                      />
                    </>
                  ) : (
                    <EmptyState text="Drag library loops here to build this draft." />
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => addDraftToArrangement(activeDraft)}
                  className="mt-3 w-full border-2 border-[#65e4a3] px-3 py-2 font-mono text-xs text-[#65e4a3] transition hover:bg-[#65e4a3] hover:text-[#101828]"
                >
                  Add Draft to Arrangement
                </button>
              </>
            ) : (
              <EmptyState text="Open a draft to preview and edit its loop order." />
            )}
          </div>
        </Panel>

        <Panel title="Arrangement">
          <div
            onDragOver={handleArrangementDragOver}
            onDrop={handleArrangementContainerDrop}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) {
                setArrangementDropIndex(null);
              }
            }}
            className="flex min-h-[156px] flex-col gap-2 border-2 border-dashed border-[#c4c4a4] bg-[#202d2d] p-3"
          >
            {arrangement.length > 0 ? (
              <>
                {arrangement.map((item, index) => {
                  const loop = savedLoops.find((savedLoop) => savedLoop.id === item.loopId);

                  if (!loop) {
                    return null;
                  }

                  return (
                    <div key={item.id} className="flex flex-col gap-2">
                      <InsertionZone
                        isActive={arrangementDropIndex === index}
                      />
                      <SequenceItem
                        itemType="arrangement"
                        index={index}
                        loop={loop}
                        isActive={isPlayingArrangement && activeSequenceIndex === index}
                        onDragStart={(event) => {
                          event.dataTransfer.setData('arrangement-index', String(index));
                          event.dataTransfer.effectAllowed = 'move';
                          setDraggedLoopId(null);
                          setDraggedArrangeIndex(index);
                          setDraggedDraftIndex(null);
                        }}
                        onDragEnd={clearDragState}
                        onEdit={() => loadLoop(loop)}
                        onMoveUp={() => moveArrangementItem(index, -1)}
                        onMoveDown={() => moveArrangementItem(index, 1)}
                        onRemove={() => removeArrangementItem(item.id)}
                        disableUp={index === 0}
                        disableDown={index === arrangement.length - 1}
                      />
                    </div>
                  );
                })}
                <InsertionZone
                  isActive={arrangementDropIndex === arrangement.length}
                />
              </>
            ) : (
              <EmptyState text="Drag loops or add a draft here. Only this row exports." />
            )}
          </div>

          <button
            type="button"
            onClick={downloadMp3}
            disabled={arrangedLoops.length === 0 || isExporting}
            className="mt-3 w-full border-4 border-[#101828] bg-[#ff6b6b] px-5 py-3 font-pixel text-xs uppercase leading-none text-[#101828] shadow-pixel transition hover:bg-[#ff8585] disabled:cursor-not-allowed disabled:bg-[#686868] disabled:text-[#2b2b2b] disabled:shadow-none"
          >
            {isExporting ? 'Exporting...' : 'Download MP3'}
          </button>
        </Panel>
      </div>

      {statusMessage ? (
        <div className="border-2 border-[#65e4a3] bg-[#18251f] px-3 py-2 font-mono text-sm text-[#65e4a3]">
          {statusMessage}
        </div>
      ) : null}

      <Panel title={isPlaying ? 'Playing Grid' : 'Editor Grid'}>
        <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_280px] lg:items-center">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleLoopPlayback}
              className="border-4 border-[#101828] bg-[#65e4a3] px-5 py-3 font-pixel text-xs uppercase leading-none text-[#101828] shadow-pixel transition hover:-translate-y-0.5 hover:bg-[#7bf2b5] active:translate-y-1 active:shadow-none"
            >
              {isPlayingLoop ? 'Stop Loop' : 'Play Loop'}
            </button>
            <button
              type="button"
              onClick={handleArrangementPlayback}
              disabled={arrangedLoops.length === 0 && !isPlayingArrangement}
              className="border-4 border-[#101828] bg-[#4cc9f0] px-5 py-3 font-pixel text-xs uppercase leading-none text-[#101828] shadow-pixel transition hover:-translate-y-0.5 hover:bg-[#72d7f4] active:translate-y-1 active:shadow-none disabled:cursor-not-allowed disabled:bg-[#686868] disabled:text-[#2b2b2b] disabled:shadow-none"
            >
              {isPlayingArrangement ? 'Stop Song' : 'Play Song'}
            </button>
            <button
              type="button"
              onClick={clearGrid}
              className="border-4 border-[#f7f7df] px-4 py-3 font-pixel text-xs uppercase leading-none text-[#f7f7df] transition hover:bg-[#f7f7df] hover:text-[#141414]"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={saveLoop}
              className="border-4 border-[#101828] bg-[#ffe66d] px-4 py-3 font-pixel text-xs uppercase leading-none text-[#101828] transition hover:bg-[#fff08f]"
            >
              Save Loop
            </button>
          </div>

          <label className="border-4 border-[#f7f7df] bg-[#202d2d] p-3 font-mono text-xs text-[#f7f7df]">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span>Tempo</span>
              <strong className="text-[#ffe66d]">{bpm} BPM</strong>
            </div>
            <input
              type="range"
              min={MIN_BPM}
              max={MAX_BPM}
              value={bpm}
              onChange={(event) => setBpm(Number(event.target.value))}
              className="w-full accent-[#65e4a3]"
            />
          </label>
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-[#c4c4a4]">
          <span>
            {isPlaying
              ? `Now playing ${playingName}`
              : 'Click bits to edit the current loop'}
          </span>
          <span>Steps 1-16</span>
        </div>

        <div className="overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-[56px_repeat(16,minmax(36px,1fr))] gap-1">
            <div />
            {stepIndexes.map((stepIndex) => (
              <div
                key={stepIndex}
                className={`h-8 border-2 border-[#101828] text-center font-mono text-xs leading-7 ${
                  activeStep === stepIndex
                    ? 'bg-[#ffe66d] text-[#101828]'
                    : 'bg-[#343434] text-[#c4c4a4]'
                }`}
              >
                {stepIndex + 1}
              </div>
            ))}

            {noteRows.map((note, rowIndex) => (
              <Row
                key={note}
                note={note}
                row={displayedGrid[rowIndex]}
                rowIndex={rowIndex}
                activeStep={activeStep}
                isPreviewing={isPlaying}
                onToggle={toggleBit}
              />
            ))}
          </div>
        </div>
      </Panel>
    </section>
  );
}

function Panel({ title, children }) {
  return (
    <section className="border-4 border-[#f7f7df] bg-[#232323] p-4 shadow-pixel">
      <h2 className="mb-3 font-pixel text-sm leading-relaxed text-[#ffe66d]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function EmptyState({ text }) {
  return (
    <div className="border-2 border-dashed border-[#c4c4a4] p-4 font-mono text-sm text-[#c4c4a4]">
      {text}
    </div>
  );
}

function LoopCard({
  loop,
  isEditing,
  onDragStart,
  onDragEnd,
  onAdd,
  onLoad,
  onRename,
  onDelete
}) {
  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`cursor-grab border-2 p-3 active:cursor-grabbing ${
        isEditing
          ? 'border-[#ffe66d] bg-[#3b3724]'
          : 'border-[#f7f7df] bg-[#283737]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <EditableTitle value={loop.name} onSave={onRename} />
          <div className="mt-1 font-mono text-xs text-[#c4c4a4]">
            {countBits(loop.grid)} bits {isEditing ? '| editing' : ''}
          </div>
        </div>
        <span className="font-mono text-xs text-[#ffe66d]">drag</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <SmallButton onClick={onAdd}>Add</SmallButton>
        <SmallButton onClick={onLoad}>Load</SmallButton>
        <SmallButton tone="danger" onClick={onDelete}>
          Delete
        </SmallButton>
      </div>
    </article>
  );
}

function DraftCard({ draft, isActive, onOpen, onAdd, onRename, onDelete }) {
  return (
    <article
      className={`border-2 p-3 ${
        isActive
          ? 'border-[#ffe66d] bg-[#3b3724]'
          : 'border-[#f7f7df] bg-[#283737]'
      }`}
    >
      <EditableTitle value={draft.name} onSave={onRename} />
      <div className="mt-1 font-mono text-xs text-[#c4c4a4]">
        {draft.items.length} loops
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <SmallButton onClick={onOpen}>Open</SmallButton>
        <SmallButton onClick={onAdd}>Add</SmallButton>
        <SmallButton tone="danger" onClick={onDelete}>
          Delete
        </SmallButton>
      </div>
    </article>
  );
}

function EditableTitle({ value, onSave }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(value);

  useEffect(() => {
    setDraftValue(value);
  }, [value]);

  const save = () => {
    const cleanValue = draftValue.trim();
    setIsEditing(false);

    if (cleanValue && cleanValue !== value) {
      onSave(cleanValue);
    } else {
      setDraftValue(value);
    }
  };

  if (isEditing) {
    return (
      <input
        value={draftValue}
        autoFocus
        onChange={(event) => setDraftValue(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }

          if (event.key === 'Escape') {
            setDraftValue(value);
            setIsEditing(false);
          }
        }}
        className="w-full border-2 border-[#65e4a3] bg-[#141414] px-2 py-1 font-pixel text-xs leading-relaxed text-[#65e4a3] outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
      className="max-w-full text-left font-pixel text-xs leading-relaxed text-[#65e4a3] underline decoration-transparent underline-offset-4 transition hover:decoration-[#65e4a3]"
      title="Click to rename"
    >
      {value}
    </button>
  );
}

function InsertionZone({ isActive }) {
  return (
    <div
      className={`pointer-events-none relative h-2 transition ${
        isActive ? 'my-2 opacity-100' : '-my-1 opacity-0'
      }`}
    >
      <div
        className={`absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 border-y border-[#101828] bg-[#ffe66d] shadow-[0_0_12px_rgba(255,230,109,0.9)] transition-transform ${
          isActive ? 'scale-x-100' : 'scale-x-0'
        }`}
      />
    </div>
  );
}

function SequenceItem({
  itemType,
  index,
  loop,
  isActive,
  onDragStart,
  onDragEnd,
  onEdit,
  onMoveUp,
  onMoveDown,
  onRemove,
  disableUp,
  disableDown
}) {
  return (
    <article
      data-arrangement-item={itemType === 'arrangement' ? 'true' : undefined}
      data-draft-item={itemType === 'draft' ? 'true' : undefined}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`cursor-grab border-2 p-3 active:cursor-grabbing ${
        isActive
          ? 'border-[#ffe66d] bg-[#3b3724]'
          : 'border-[#f7f7df] bg-[#283737]'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-pixel text-xs leading-relaxed text-[#65e4a3]">
            {index + 1}. {loop.name}
          </div>
          <div className="mt-1 font-mono text-xs text-[#c4c4a4]">
            {countBits(loop.grid)} bits
          </div>
        </div>

        <div className="flex gap-1">
          <IconButton
            label={`${loop.name} move left`}
            disabled={disableUp}
            onClick={onMoveUp}
          >
            ^
          </IconButton>
          <IconButton
            label={`${loop.name} move right`}
            disabled={disableDown}
            onClick={onMoveDown}
          >
            v
          </IconButton>
          <IconButton label={`Remove ${loop.name}`} onClick={onRemove}>
            x
          </IconButton>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <SmallButton onClick={onEdit}>Edit</SmallButton>
      </div>
      <div className="mt-2 h-2 bg-[#141414]">
        <div
          className="h-full bg-[#ff6b6b]"
          style={{ width: `${Math.min(100, countBits(loop.grid) * 3)}%` }}
        />
      </div>
    </article>
  );
}

function SmallButton({ tone = 'default', onClick, children }) {
  const toneClass =
    tone === 'danger'
      ? 'border-[#ff6b6b] text-[#ffb1b1] hover:bg-[#ff6b6b]'
      : 'border-[#65e4a3] text-[#65e4a3] hover:bg-[#65e4a3]';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-2 px-3 py-2 font-mono text-xs transition hover:text-[#101828] ${toneClass}`}
    >
      {children}
    </button>
  );
}

function IconButton({ label, disabled = false, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="h-8 w-8 border-2 border-[#f7f7df] font-mono text-xs text-[#f7f7df] transition hover:bg-[#f7f7df] hover:text-[#101828] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#f7f7df]"
    >
      {children}
    </button>
  );
}

function Row({ note, row, rowIndex, activeStep, isPreviewing, onToggle }) {
  return (
    <>
      <div className="flex h-9 items-center justify-end pr-2 font-mono text-xs text-[#65e4a3]">
        {note}
      </div>
      {row.map((isActive, stepIndex) => (
        <button
          key={`${note}-${stepIndex}`}
          type="button"
          aria-label={`${note} step ${stepIndex + 1}`}
          aria-pressed={isActive}
          disabled={isPreviewing}
          onClick={() => onToggle(rowIndex, stepIndex)}
          className={`h-9 border-2 border-[#101828] transition ${
            isActive
              ? 'bg-[#ff6b6b] shadow-[inset_0_0_0_4px_#ffe66d]'
              : 'bg-[#3b3b3b] hover:bg-[#4e4e4e]'
          } ${activeStep === stepIndex ? 'ring-2 ring-[#ffe66d]' : ''} ${
            isPreviewing ? 'cursor-default' : ''
          }`}
        />
      ))}
    </>
  );
}
