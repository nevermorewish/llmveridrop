"""DeepSeek detector registry."""

from relay_detector.protocols.openai.detectors.basic_request import BasicRequestDetector
from relay_detector.protocols.openai.detectors.function_calling import FunctionCallingDetector
from relay_detector.protocols.openai.detectors.long_context import LongContextDetector
from relay_detector.protocols.openai.detectors.model_consistency import ModelConsistencyDetector
from relay_detector.protocols.openai.detectors.protocol import ProtocolDetector
from .streaming_usage import StreamingUsageDetector


def build_all():
    return [
        BasicRequestDetector(),
        ModelConsistencyDetector(),
        ProtocolDetector(),
        StreamingUsageDetector(),
        FunctionCallingDetector(),
        LongContextDetector(),
    ]


__all__ = [
    "BasicRequestDetector",
    "ModelConsistencyDetector",
    "ProtocolDetector",
    "StreamingUsageDetector",
    "FunctionCallingDetector",
    "LongContextDetector",
    "build_all",
]
