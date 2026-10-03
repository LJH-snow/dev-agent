use std::io::{self, Read, Write};

use prost::Message;

use crate::proto::dev_agent::executor::{Envelope, Response};

/// Maximum protobuf payload accepted or emitted by the stdio transport.
///
/// The TypeScript client mirrors this default. Callers that need a smaller
/// boundary can use the `*_with_limit` helpers in tests or an embedding host.
pub const DEFAULT_MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    #[error("protobuf decode error: {0}")]
    Decode(#[from] prost::DecodeError),
    #[error("protobuf encode error: {0}")]
    Encode(#[from] prost::EncodeError),
    #[error("frame length {length} exceeds maximum of {max} bytes")]
    FrameTooLarge { length: usize, max: usize },
}

pub fn read_envelope<R: Read>(reader: &mut R) -> Result<Option<Envelope>, TransportError> {
    read_envelope_with_limit(reader, DEFAULT_MAX_FRAME_BYTES)
}

pub fn read_envelope_with_limit<R: Read>(
    reader: &mut R,
    max_frame_bytes: usize,
) -> Result<Option<Envelope>, TransportError> {
    let mut length_buf = [0u8; 4];
    if reader.read(&mut length_buf[..1])? == 0 {
        return Ok(None);
    }
    reader.read_exact(&mut length_buf[1..])?;
    let length = u32::from_be_bytes(length_buf) as usize;
    if length > max_frame_bytes {
        return Err(TransportError::FrameTooLarge {
            length,
            max: max_frame_bytes,
        });
    }

    let mut message_buf = vec![0u8; length];
    reader.read_exact(&mut message_buf)?;

    let envelope = Envelope::decode(&message_buf[..])?;
    Ok(Some(envelope))
}

pub fn write_response<W: Write>(writer: &mut W, response: &Response) -> Result<(), TransportError> {
    write_response_with_limit(writer, response, DEFAULT_MAX_FRAME_BYTES)
}

pub fn write_response_with_limit<W: Write>(
    writer: &mut W,
    response: &Response,
    max_frame_bytes: usize,
) -> Result<(), TransportError> {
    let encoded = response.encode_to_vec();
    if encoded.len() > max_frame_bytes {
        return Err(TransportError::FrameTooLarge {
            length: encoded.len(),
            max: max_frame_bytes,
        });
    }
    writer.write_all(&(encoded.len() as u32).to_be_bytes())?;
    writer.write_all(&encoded)?;
    writer.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::dev_agent::executor::{response::Payload, Envelope, RunRequest, RunResult};

    #[test]
    fn write_then_read_roundtrip() {
        let response = Response {
            request_id: Some(42),
            payload: Some(Payload::RunResult(RunResult {
                stdout: "hello".to_string(),
                stderr: "".to_string(),
                exit_code: 0,
                timed_out: false,
                bytes_truncated: false,
            })),
        };

        let mut buf = Vec::new();
        write_response(&mut buf, &response).unwrap();

        // First 4 bytes are the big-endian length.
        let len = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
        assert_eq!(len, buf.len() - 4);

        let envelope = Envelope {
            request_id: Some(7),
            payload: Some(crate::proto::dev_agent::executor::envelope::Payload::Run(
                RunRequest {
                    command: "echo".to_string(),
                    args: vec!["hello".to_string()],
                    cwd: None,
                    env: std::collections::HashMap::new(),
                    input: None,
                    timeout_ms: None,
                    max_output_bytes: None,
                },
            )),
        };
        let encoded = envelope.encode_to_vec();
        let mut framed = Vec::new();
        framed.extend_from_slice(&(encoded.len() as u32).to_be_bytes());
        framed.extend_from_slice(&encoded);

        let mut reader = framed.as_slice();
        let decoded = read_envelope(&mut reader).unwrap().unwrap();
        assert_eq!(decoded.request_id, Some(7));
    }

    #[test]
    fn read_envelope_handles_eof() {
        let mut reader: &[u8] = &[];
        let result = read_envelope(&mut reader).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn read_envelope_handles_truncated() {
        let mut reader: &[u8] = &[0x00, 0x00, 0x00, 0x10, 0x08];
        let result = read_envelope(&mut reader);
        // Should error because the stream ends before the full message.
        assert!(result.is_err());
    }

    #[test]
    fn read_envelope_rejects_partial_length_prefix() {
        for prefix in [&[0x00][..], &[0x00, 0x00][..], &[0x00, 0x00, 0x00][..]] {
            let mut reader = prefix;
            let result = read_envelope(&mut reader);
            assert!(
                result.is_err(),
                "partial frame prefix must be an error: {prefix:?}"
            );
        }
    }

    #[test]
    fn read_envelope_rejects_frame_above_the_configured_limit() {
        let mut reader: &[u8] = &[0x00, 0x00, 0x00, 0x10];
        let error = read_envelope_with_limit(&mut reader, 8).unwrap_err();
        assert!(matches!(
            error,
            TransportError::FrameTooLarge { length: 16, max: 8 }
        ));
    }

    #[test]
    fn write_response_rejects_encoded_frame_above_the_configured_limit() {
        let response = Response {
            request_id: Some(42),
            payload: Some(Payload::RunResult(RunResult {
                stdout: "0123456789".to_string(),
                stderr: "".to_string(),
                exit_code: 0,
                timed_out: false,
                bytes_truncated: false,
            })),
        };
        let mut buf = Vec::new();
        let error = write_response_with_limit(&mut buf, &response, 4).unwrap_err();
        assert!(matches!(
            error,
            TransportError::FrameTooLarge { length: _, max: 4 }
        ));
        assert!(buf.is_empty());
    }
}
