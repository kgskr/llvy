import "server-only";

import { createAutocompleteIndex } from "@/lib/autocomplete-index";
import {
  nicknameIndexKey,
  projectNicknameSuggestion,
} from "@/lib/search-contract";
export {
  AUTOCOMPLETE_LIMIT,
  normalizeNicknamePrefix,
  normalizeSearchPart as normalizeNicknamePart,
} from "@/lib/search-contract";
export type { NicknameSuggestion } from "@/lib/search-contract";

export const queryNicknameAutocomplete = createAutocompleteIndex({
  namespace: "autocomplete:v1",
  indexedName: nicknameIndexKey,
  project: projectNicknameSuggestion,
});
