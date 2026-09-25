"""Motor DSP determinístico: executa cadeias de presets (contrato em packages/contracts)."""

from __future__ import annotations

import json
from functools import lru_cache
from importlib import resources
from typing import Any, Callable

import jsonschema
import numpy as np

from . import dynamics, filters, space, tone

ModuleFn = Callable[..., np.ndarray]

REGISTRY: dict[str, ModuleFn] = {
    "gain": tone.gain,
    "highpass": filters.highpass,
    "lowpass": filters.lowpass,
    "eq_peak": filters.eq_peak,
    "eq_shelf": filters.eq_shelf,
    "compressor": dynamics.compressor,
    "limiter": dynamics.limiter,
    "gate": dynamics.gate,
    "saturation": tone.saturation,
    "soft_clip": tone.soft_clip,
    "stereo_width": space.stereo_width,
    "delay": space.delay,
    "reverb": space.reverb,
    "normalize": tone.normalize,
}


class ChainError(ValueError):
    pass


@lru_cache(maxsize=1)
def _schema_files() -> tuple[dict[str, Any], dict[str, Any]]:
    base = resources.files("mixpro_worker") / "schema"
    chain = json.loads((base / "chain.schema.json").read_text(encoding="utf-8"))
    modules = json.loads((base / "modules.json").read_text(encoding="utf-8"))
    return chain, modules


def module_specs() -> dict[str, Any]:
    return _schema_files()[1]


def validate_chain(doc: Any) -> None:
    schema, modules = _schema_files()
    try:
        jsonschema.validate(doc, schema)
    except jsonschema.ValidationError as exc:
        raise ChainError(f"Cadeia inválida: {exc.message}") from exc
    missing = {m["type"] for m in doc["chain"]} - REGISTRY.keys()
    if missing or set(modules) - REGISTRY.keys():
        raise ChainError(f"Módulos sem implementação: {sorted(missing or set(modules) - REGISTRY.keys())}")


def resolve_params(module_type: str, params: dict[str, Any], intensity: int) -> dict[str, Any]:
    """Aplica defaults e interpola parâmetros pela intensidade (espelha resolveParam no TS)."""
    spec = module_specs()[module_type]["params"]
    out: dict[str, Any] = {}
    for name, p in spec.items():
        raw = params.get(name)
        if p["kind"] == "enum":
            out[name] = raw if raw is not None else p["default"]
            continue
        if raw is None:
            val = p["default"]
        elif isinstance(raw, (int, float)):
            val = raw
        else:
            neutral = raw.get("neutral", p.get("neutral", raw["value"]))
            val = neutral + (raw["value"] - neutral) * (intensity / 100.0)
        out[name] = float(min(max(val, p["min"]), p["max"]))
    return out


def run_chain(audio: np.ndarray, sr: int, doc: dict[str, Any], intensity: int,
              on_step: Callable[[int, int], None] | None = None) -> np.ndarray:
    validate_chain(doc)
    steps = [m for m in doc["chain"] if not m.get("bypass")]
    x = np.ascontiguousarray(audio, dtype=np.float32)
    for i, mod in enumerate(steps):
        params = resolve_params(mod["type"], mod.get("params", {}), intensity)
        x = REGISTRY[mod["type"]](x, sr, **params)
        if not np.all(np.isfinite(x)):
            raise ChainError(f"O módulo '{mod['type']}' gerou valores inválidos")
        x = np.ascontiguousarray(x, dtype=np.float32)
        if on_step:
            on_step(i + 1, len(steps))
    return x
