use std::io::{self, Read, Write};

use prost::Message;

use crate::proto::dev_agent::executor::{Envelope, Response};

#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    #[error("protobuf decode error: {0}")]
    Decode(#[from] prost::DecodeError),
    #[error("protobuf encode error: {0}")]
    Encode(#[from] prost::EncodeError),
}

pub fn read_envelope<R: Read>(reader: &mut R) -> Result<Option<Envelope>, TransportError> {
    let mut length_buf = [0u8; 4];
    if let Err(err) = reader.read_exact(&mut length_buf) {
        if err.kind() == io::ErrorKind::UnexpectedEof {
            return Ok(None);
        }
        return Err(TransportError::Io(err));
    }
    let length = u32::from_be_bytes(length_buf) as usize;

    let mut message_buf = vec![0u8; length];
    reader.read_exact(&mut message_buf)?;

    let envelope = Envelope::decode(&message_buf[..])?;
    Ok(Some(envelope))
}

pub fn write_response<W: Write>(writer: &mut W, response: &Response) -> Result<(), TransportError> {
    let encoded = response.encode_to_vec();
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
}
