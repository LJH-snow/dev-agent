const ESC = "\u001b";
const MAX_QUERY_RESPONSE_LENGTH = 32;

type QueryProbe =
  | { readonly status: "none" }
  | { readonly status: "partial" }
  | { readonly status: "complete"; readonly endIndex: number };

export interface KittyQueryFilterResult {
  /** Input text that should continue through Ink's normal key router. */
  readonly input: string;
  /** True when the event contained or buffered a Kitty query response. */
  readonly consumed: boolean;
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function probeQueryAt(value: string, startIndex: number): QueryProbe {
  const first = value[startIndex];
  let prefixLength: number;

  if (first === ESC) {
    if (startIndex + 1 >= value.length) return { status: "partial" };
    if (value[startIndex + 1] !== "[") return { status: "none" };
    if (startIndex + 2 >= value.length) return { status: "partial" };
    if (value[startIndex + 2] !== "?") return { status: "none" };
    prefixLength = 3;
  } else if (first === "[") {
    if (startIndex + 1 >= value.length) return { status: "none" };
    if (value[startIndex + 1] !== "?") return { status: "none" };
    prefixLength = 2;
  } else {
    return { status: "none" };
  }

  let index = startIndex + prefixLength;
  const digitsStartIndex = index;
  while (index < value.length && isDigit(value[index])) {
    index += 1;
  }

  if (index === digitsStartIndex) {
    return index === value.length
      ? { status: "partial" }
      : { status: "none" };
  }
  if (index === value.length) {
    return value.length - startIndex >= MAX_QUERY_RESPONSE_LENGTH
      ? { status: "none" }
      : { status: "partial" };
  }
  if (value[index] !== "u") return { status: "none" };
  if (index + 1 - startIndex > MAX_QUERY_RESPONSE_LENGTH) {
    return { status: "none" };
  }

  return { status: "complete", endIndex: index + 1 };
}

interface QueryScanResult {
  readonly input: string;
  readonly pending?: string;
  readonly consumed: boolean;
}

function scanQueryResponses(value: string): QueryScanResult {
  let remainder = value;
  let consumed = false;

  // Only recognize a response at the start of the current remainder. This
  // keeps ordinary text such as `note [?0u` intact while still consuming
  // adjacent responses after a known response has already been removed.
  while (remainder.length > 0) {
    const probe = probeQueryAt(remainder, 0);
    if (probe.status === "none") {
      return { input: remainder, consumed };
    }
    consumed = true;
    if (probe.status === "partial") {
      return { input: "", pending: remainder, consumed };
    }
    remainder = remainder.slice(probe.endIndex);
  }

  return { input: "", consumed };
}

/**
 * Filters the response to Ink's Kitty keyboard capability query at the
 * protocol boundary. Ink's useInput strips a leading ESC from unknown CSI
 * sequences, so both the raw and ESC-stripped spellings are accepted.
 *
 * The filter scans every bounded input event so adjacent query responses are
 * consumed too, while buffering only a short, valid query prefix. Malformed
 * or oversized values are returned unchanged so normal keyboard, mouse, and
 * paste input cannot be swallowed.
 */
export class KittyQueryResponseFilter {
  private pending = "";

  push(input: string): KittyQueryFilterResult {
    if (input.length === 0) {
      return { input, consumed: false };
    }

    const result = scanQueryResponses(this.pending + input);
    this.pending = result.pending ?? "";
    return {
      input: result.input,
      consumed: result.consumed,
    };
  }

  flush(): string {
    const pending = this.pending;
    this.pending = "";
    return pending;
  }

  reset(): void {
    this.pending = "";
  }
}

export function filterKittyQueryResponse(input: string): string {
  return new KittyQueryResponseFilter().push(input).input;
}
