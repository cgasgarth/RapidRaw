import {
  EditedStatus,
  type FilterCriteria,
  RawStatus,
  type SortCriteria,
  SortDirection,
} from '../components/ui/AppProperties';
import type { SearchCriteria } from '../store/useLibraryStore';
import { type LibrarySearchProjection, parseShutter } from './LibrarySearchProjection';

export const ADVANCED_QUERY_REGEX =
  /^(iso|aperture|f|shutter|s|focal|mm|rating|color|camera|make|model|lens)\s*(?::)?\s*(>=|<=|>|<|=)?\s*(.+)$/i;

interface NormalTag {
  type: 'normal';
  value: string;
}
interface AdvancedTag {
  field: string;
  operator: string;
  type: 'query';
  value: string;
  numericValue: number;
}
type CompiledTag = NormalTag | AdvancedTag;

export interface CompiledLibraryQuery {
  compare(a: LibrarySearchProjection, b: LibrarySearchProjection): number;
  filter(projection: LibrarySearchProjection): boolean;
  rawOverNonRaw: boolean;
}

export function compileLibraryQuery(
  searchCriteria: SearchCriteria,
  filterCriteria: FilterCriteria,
  sortCriteria: SortCriteria,
): CompiledLibraryQuery {
  const searchText = searchCriteria.text.trim().toLowerCase();
  const colors = new Set(filterCriteria.colors);
  const tags = searchCriteria.tags.map(compileTag);
  const ascending = sortCriteria.order === SortDirection.Ascending;

  return {
    rawOverNonRaw: filterCriteria.rawStatus === RawStatus.RawOverNonRaw,
    filter(projection) {
      if (filterCriteria.rating !== 0) {
        if (filterCriteria.rating === -1 && projection.rating !== 0) return false;
        if (filterCriteria.rating === 5 && projection.rating !== 5) return false;
        if (filterCriteria.rating > 0 && filterCriteria.rating < 5 && projection.rating < filterCriteria.rating)
          return false;
      }
      if (filterCriteria.rawStatus === RawStatus.RawOnly && !projection.isRaw) return false;
      if (filterCriteria.rawStatus === RawStatus.NonRawOnly && projection.isRaw) return false;
      if (filterCriteria.editedStatus === EditedStatus.EditedOnly && !projection.isEdited) return false;
      if (filterCriteria.editedStatus === EditedStatus.UneditedOnly && projection.isEdited) return false;
      if (colors.size > 0 && !colors.has(projection.colorLabel ?? 'none')) return false;
      if (tags.length > 0) {
        let matched = searchCriteria.mode !== 'OR';
        for (const tag of tags) {
          const current = tagMatches(tag, projection);
          if (searchCriteria.mode === 'OR' && current) {
            matched = true;
            break;
          }
          if (searchCriteria.mode !== 'OR' && !current) {
            matched = false;
            break;
          }
        }
        if (!matched) return false;
      }
      if (searchText !== '' && !projection.normalizedFileName.includes(searchText)) {
        let tagMatch = false;
        for (const tag of projection.normalizedUserTags) {
          if (tag.includes(searchText)) {
            tagMatch = true;
            break;
          }
        }
        if (!tagMatch) return false;
      }
      return true;
    },
    compare(a, b) {
      let comparison = compareByKey(a, b, sortCriteria.key);
      if (comparison === 0 && sortCriteria.key !== 'name') comparison = a.fileName.localeCompare(b.fileName);
      if (comparison !== 0) return ascending ? comparison : -comparison;
      comparison = a.path.localeCompare(b.path);
      return comparison !== 0 ? comparison : a.stableOrdinal - b.stableOrdinal;
    },
  };
}

function compileTag(tag: string): CompiledTag {
  const match = ADVANCED_QUERY_REGEX.exec(tag);
  if (!match) return { type: 'normal', value: tag.toLowerCase() };
  const field = (match[1] ?? '').toLowerCase();
  const value = (match[3] ?? '').toLowerCase();
  return {
    type: 'query',
    field,
    operator: match[2] ?? '=',
    value,
    numericValue: field === 'shutter' || field === 's' ? parseShutter(value) : Number.parseFloat(value),
  };
}

function tagMatches(tag: CompiledTag, projection: LibrarySearchProjection): boolean {
  if (tag.type === 'normal') {
    for (const imageTag of projection.normalizedUserTags) if (imageTag.includes(tag.value)) return true;
    return false;
  }
  let numeric: number | null = null;
  if (tag.field === 'iso') numeric = projection.iso;
  else if (tag.field === 'aperture' || tag.field === 'f') numeric = projection.aperture;
  else if (tag.field === 'shutter' || tag.field === 's') numeric = projection.shutterSeconds;
  else if (tag.field === 'focal' || tag.field === 'mm') numeric = projection.focalLengthMm;
  else if (tag.field === 'rating') numeric = projection.rating;
  if (numeric !== null) return compareNumeric(numeric, tag.numericValue, tag.operator);
  let text = '';
  if (tag.field === 'camera' || tag.field === 'make' || tag.field === 'model') text = projection.cameraSearchText;
  else if (tag.field === 'lens') text = projection.lensSearchText;
  else if (tag.field === 'color') text = projection.colorLabel ?? '';
  return (tag.operator === '=' || tag.operator === ':') && text.includes(tag.value);
}

function compareNumeric(actual: number, expected: number, operator: string): boolean {
  if (operator === '>') return actual > expected;
  if (operator === '<') return actual < expected;
  if (operator === '>=') return actual >= expected;
  if (operator === '<=') return actual <= expected;
  return actual === expected;
}

function compareByKey(a: LibrarySearchProjection, b: LibrarySearchProjection, key: string): number {
  if (key === 'date_taken')
    return a.dateTaken === b.dateTaken ? a.modified - b.modified : a.dateTaken < b.dateTaken ? -1 : 1;
  if (key === 'iso') return a.iso - b.iso;
  if (key === 'shutter_speed') return a.shutterSeconds - b.shutterSeconds;
  if (key === 'aperture') return a.aperture - b.aperture;
  if (key === 'focal_length') return a.focalLengthMm - b.focalLengthMm;
  if (key === 'date') return a.modified - b.modified;
  if (key === 'rating') return a.rating - b.rating;
  if (key === 'edited') return a.isEdited === b.isEdited ? 0 : a.isEdited ? 1 : -1;
  return a.fileName.localeCompare(b.fileName);
}
