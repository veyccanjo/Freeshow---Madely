import { get } from "svelte/store"
import type { Item, LayoutRef } from "../../../types/Show"
import type { StageItem, StageLayout } from "../../../types/Stage"
import { isOutputWindow } from "../../utils/common"
import { translateText } from "../../utils/language"
import { arrayToObject, filterObjectArray } from "../../utils/sendData"
import { getItemText } from "../edit/scripts/textStyle"
import { getActiveOutputs } from "../helpers/output"
import { getLayoutRef } from "../helpers/show"
import { STAGE } from "./../../../types/Channels"
import { activeStage, allOutputs, connections, outputs, outputSlideCache, showsCache, stageShows, timers, variables } from "./../../stores"

export function updateStageShow() {
    Object.entries(get(connections).STAGE || {}).forEach(([id, stage]) => {
        const show = arrayToObject(filterObjectArray([get(stageShows)[stage.active || ""]], ["disabled", "name", "settings", "items"]))[0]
        if (!show) return
        if (!show.disabled) window.api.send(STAGE, { channel: "LAYOUT", id, data: show })
    })
}

export function getCustomStageLabel(itemId: string, item: StageItem, _updater: any = null): string {
    if (!itemId.includes("#")) {
        let name = ""

        if (itemId === "variable") name = get(variables)[item.variable?.id || ""]?.name
        else if (itemId === "timer") name = get(timers)[item.timer?.id]?.name
        else if (itemId === "text") name = dynamicValueString(getItemText(item as Item))

        name = name || translateText(`items.${itemId}`)

        const slideOffset = Number(item.slideOffset || 0)
        if (itemId === "slide_text" && slideOffset === 0) name = translateText("stage.current_slide_text") || name
        else if (itemId === "slide_text" && slideOffset === 1) name = translateText("stage.next_slide_text") || name + " +1"
        else if ((itemId === "slide_text" || itemId === "slide_notes") && slideOffset) name += ` ${slideOffset > 0 ? "+" : ""}${slideOffset}`

        return name
    }

    // < 1.4.0
    if (itemId.includes("global_timers") && !itemId.includes("first_active_timer")) return get(timers)[getStageItemId(itemId)]?.name || ""
    if (itemId.includes("variables")) return get(variables)[getStageItemId(itemId)]?.name || ""

    return translateText(`stage.${itemId.split("#")[1]}`)
}

function dynamicValueString(text: string) {
    // check if it is a dynamic value
    const regex = /^\{.*\}$/
    if (!regex.test(text)) return ""

    text = text.slice(1, -1)
    if (!text.length || text.includes("{") || text.includes("}")) return ""

    const fallback = text.indexOf("|")
    if (fallback !== -1) text = text.slice(0, fallback)

    text = text.replace("$", "").replace("variable_", "")
    // if (text.includes("$") || text.includes("variable_")) {
    //     text = text.replace("$", "variable_").replace("variable_", "variable:_")
    //     // text = (get(dictionary).items?.variable || "Variable") + ": " + (text.replace("$", "").replace("variable_", ""))
    // }

    text = text.replace("meta_", "").replace("time_", "")
    if (!text.length) return ""

    if (text === "bpm" || text === "ccli") return text.toUpperCase()

    // return text.split("_").map((a) => `${a[0].toUpperCase()}${a.slice(1)}`).join(" ")
    return text[0].toUpperCase() + text.slice(1).replaceAll("_", " ")
}

export function getStageItemId(itemId: string) {
    return itemId.split("#")[1]
}

export function stageItemToItem(item: StageItem) {
    const newItem: Item = {
        style: item?.style || ""
    }
    if (!item) return newItem

    // type, align, auto, src, timer, clock, tracker, variable, etc.
    if (item.chords) newItem.chords = typeof item.chords === "boolean" ? { enabled: item.chords, ...((item as any).chordsData || {}) } : item.chords
    // if (item.clock) newItem.clock = { seconds: true, ...item.clock }

    return { ...item, ...newItem } as Item
}

export function getSlideTextItems(stageLayout: StageLayout, item: StageItem, _updater: any = null) {
    const slideOffset = Number(item.slideOffset || 0)
    const currentShow = stageLayout === null ? (get(activeStage).id ? get(stageShows)[get(activeStage).id!] : null) : stageLayout
    const stageMainOutputId = currentShow?.settings?.output || getActiveOutputs(isOutputWindow() ? get(allOutputs) : get(outputs), false, true, true)[0]
    const currentOutput = get(outputs)[stageMainOutputId] || get(allOutputs)[stageMainOutputId] || {}
    const currentSlide = currentOutput.out?.slide || (slideOffset !== 0 ? get(outputSlideCache)[stageMainOutputId] || null : null)
    const showRef = currentSlide ? getLayoutRef(currentSlide.id) : []

    const slideIndex = currentSlide && currentSlide.index !== undefined && currentSlide.id !== "temp" ? currentSlide.index : null
    const customOffset = getStageTextLayoutOffset(showRef, slideOffset, slideIndex)

    const slideId = (customOffset !== null || slideIndex !== null) && showRef ? showRef[(customOffset ?? slideIndex)!]?.id || null : null
    const currentItems = get(showsCache)[currentSlide?.id]?.slides?.[slideId || ""]?.items || []
    return currentItems
}

// NEW: Calculate NEXT SONG name (not next slide)
// - Determines the active output & current playback position
// - Walks the flattened layoutRef and finds the first later entry whose resolved slide.group differs
// - Returns the normalized group name or null if none found
export function getNextSongName(stageLayout: StageLayout | null = null): string | null {
    // Determine active show/context like other helpers do
    const currentShow = stageLayout === null ? (get(activeStage).id ? get(stageShows)[get(activeStage).id!] : null) : stageLayout
    const stageMainOutputId = currentShow?.settings?.output || getActiveOutputs(isOutputWindow() ? get(allOutputs) : get(outputs), false, true, true)[0]

    // Resolve the current output and its published slide info
    const currentOutput = get(outputs)[stageMainOutputId] || get(allOutputs)[stageMainOutputId] || {}
    const currentSlide = currentOutput.out?.slide || get(outputSlideCache)[stageMainOutputId] || null

    if (!currentSlide || currentSlide.id === "temp") return null

    const showId = currentSlide.id
    const layoutRef: LayoutRef[] = getLayoutRef(showId)
    if (!layoutRef || layoutRef.length === 0) return null

    // Prefer explicit layout index from the output to select the correct layoutRef entry (handles repeated slide IDs)
    const currentRefIndex = typeof currentSlide.index === "number" ? currentSlide.index : layoutRef.findIndex((e) => e.id === (currentSlide as any).slideId || e.id === (currentSlide as any).id)
    if (currentRefIndex === -1 || currentRefIndex === null || currentRefIndex === undefined) return null

    const shows = get(showsCache)
    const show = shows[showId]
    if (!show) return null

    // Helper to resolve a LayoutRef entry to its canonical slide.group (fall back to parent if child has no group)
    const resolveEntryGroup = (entry: LayoutRef): string | null => {
        const slideObj = show.slides?.[entry.id]
        let group = slideObj?.group ?? null
        if (group === null && entry.parent) {
            // parent.layoutIndex should point to parent entry index in layoutRef array
            const parentIndex = entry.parent.layoutIndex
            const parentEntry = layoutRef[parentIndex]
            if (parentEntry) group = show.slides?.[parentEntry.id]?.group ?? null
        }
        return group ?? null
    }

    // Determine current group (account for child entries without group)
    const currentEntry = layoutRef[currentRefIndex]
    if (!currentEntry) return null
    const currentGroup = resolveEntryGroup(currentEntry)

    // Walk forward through layoutRef to find first entry with a different resolved group
    for (let i = currentRefIndex + 1; i < layoutRef.length; i++) {
        const entry = layoutRef[i]
        if (!entry) continue
        // Skip disabled entries
        if (entry.data?.disabled) continue

        const entryGroup = resolveEntryGroup(entry)
        // Different group (including null vs non-null) marks next SONG boundary
        if (entryGroup !== currentGroup) {
            return entryGroup || null
        }
    }

    // No next song found
    return null
}

// GET CORRECT INDEX OFFSET, EXCLUDING DISABLED SLIDES
export function getStageTextLayoutOffset(showRef: LayoutRef[], slideOffset: number, slideIndex: number | null) {
    let customOffset: number | null = null
    if (slideOffset > 0 && slideIndex !== null && showRef) {
        let layoutOffset = slideIndex
        let offsetFromCurrentExcludingDisabled = 0
        while (offsetFromCurrentExcludingDisabled < slideOffset && layoutOffset <= showRef.length) {
            layoutOffset++
            if (!showRef[layoutOffset]?.data?.disabled) offsetFromCurrentExcludingDisabled++
        }
        customOffset = layoutOffset
    } else if (slideOffset < 0 && slideIndex !== null && showRef) {
        let layoutOffset = slideIndex
        let offsetFromCurrentExcludingDisabled = 0
        while (offsetFromCurrentExcludingDisabled > slideOffset && layoutOffset >= 0) {
            layoutOffset--
            if (!showRef[layoutOffset]?.data?.disabled) offsetFromCurrentExcludingDisabled--
        }
        customOffset = layoutOffset
    } else customOffset = null

    return customOffset
}
