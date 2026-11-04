# Public-domain recognition fixture

`jfk.wav` is an 11.0-second, mono 16 kHz PCM excerpt of President John F.
Kennedy's January 20, 1961 inaugural address. It is a U.S. federal government
speech/recording, in the public domain in the United States, not a user's lecture.

- Exact source: https://raw.githubusercontent.com/ggml-org/whisper.cpp/a09ce6e8899198015729ffc49ae10f67370906b1/samples/jfk.wav
- SHA-256: `59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e`
- Historical text: https://www.archives.gov/milestone-documents/president-john-f-kennedys-inaugural-address
- Government recording rights: https://static.jfklibrary.org/3um4302v4852wwbc3o4dm087nwa7011l.pdf
- `reference.txt` is the spoken excerpt, used to measure case/punctuation-normalized
  word error rate. The inference process never receives this reference.

The real-model integration test requires at most 20% word error rate, valid
timestamp ranges, and working media/ink clock mapping. This one clean English
clip does not measure noisy classroom, accent, multilingual or technical-term accuracy.
