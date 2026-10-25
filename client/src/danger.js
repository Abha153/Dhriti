// Same pattern as server/chat-utils.js. The client needs its own copy so the call-112 buttons appear even when the server is unreachable.
// server/chat-utils.test.js fails if the two ever differ.
export const DANGER = /(suicide|kill myself|end my life|want to die|hurt myself|khudkushi|aatmahatya|mar jaun|marna chahti|being followed|abhi.*(khatre|danger)|pichha kar|in danger|\brape[ds]?\b|molest|assault|bachao)/i;
