"""Testes do motor DSP com sinais sintéticos (medições objetivas)."""

import math

import numpy as np
import pytest

from mixpro_worker import analysis
from mixpro_worker.dsp import ChainError, dynamics, filters, resolve_params, run_chain, space, tone

SR = 48000


def sine(freq, db=-6.0, seconds=1.0, ch=2):
    t = np.arange(int(SR * seconds)) / SR
    x = (10 ** (db / 20) * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    return np.tile(x, (ch, 1))


def level_db(x, skip=0.25):
    """RMS em dB ignorando o transiente inicial."""
    s = x[:, int(SR * skip):]
    return 20 * math.log10(float(np.sqrt(np.mean(s.astype(np.float64) ** 2))) + 1e-12)


# ---------------------------------------------------------------- filtros / EQ
def test_highpass_atenua_grave_e_preserva_medio():
    low, mid = sine(30), sine(1000)
    assert level_db(low) - level_db(filters.highpass(low, SR, 120, "12")) > 20
    assert abs(level_db(mid) - level_db(filters.highpass(mid, SR, 120, "12"))) < 0.1


def test_lowpass_24db_atenua_agudo():
    hi = sine(12000)
    assert level_db(hi) - level_db(filters.lowpass(hi, SR, 2000, "24")) > 60


@pytest.mark.parametrize("gain_db", [6.0, -9.0])
def test_eq_peak_ganho_no_centro(gain_db):
    x = sine(1000)
    assert abs(level_db(filters.eq_peak(x, SR, 1000, gain_db, 1.0)) - level_db(x) - gain_db) < 0.1


def test_eq_shelf_agudos():
    hi, lo = sine(16000), sine(100)
    assert abs(level_db(filters.eq_shelf(hi, SR, "high", 6000, 6.0, 0.707)) - level_db(hi) - 6.0) < 0.3
    assert abs(level_db(filters.eq_shelf(lo, SR, "high", 6000, 6.0, 0.707)) - level_db(lo)) < 0.1


# ---------------------------------------------------------------- dinâmica
def test_compressor_reduz_acima_do_threshold():
    x = sine(1000, db=-6.0, seconds=2.0)
    y = dynamics.compressor(x, SR, threshold_db=-20, ratio=4, attack_ms=5, release_ms=100, knee_db=0, makeup_db=0)
    reduction = level_db(x, 1.0) - level_db(y, 1.0)
    # 14 dB acima do threshold com ratio 4 → ~10,5 dB de redução estática
    assert 8.5 < reduction < 12.0


def test_compressor_nao_altera_abaixo_do_threshold():
    x = sine(1000, db=-30.0)
    y = dynamics.compressor(x, SR, threshold_db=-20, ratio=4, attack_ms=5, release_ms=100, knee_db=0, makeup_db=0)
    assert np.allclose(x, y, atol=1e-6)


def test_limiter_respeita_teto_sem_alterar_duracao():
    x = sine(200, db=0.0, seconds=1.0) * 2.0  # +6 dBFS
    x[:, : SR // 2] *= 0.05  # primeira metade baixa
    y = dynamics.limiter(x, SR, ceiling_db=-1.0, input_gain_db=0, release_ms=50, lookahead_ms=5)
    assert y.shape == x.shape
    assert float(np.max(np.abs(y))) <= 10 ** (-1 / 20) + 1e-6
    # trecho baixo e distante do pico não é afetado
    assert np.allclose(y[:, 1000: SR // 2 - 2000], x[:, 1000: SR // 2 - 2000], atol=1e-4)


def test_gate_atenua_ruido_e_preserva_sinal():
    rng = np.random.default_rng(0)
    noise = (rng.standard_normal((2, SR)) * 10 ** (-70 / 20)).astype(np.float32)
    tone_ = sine(440, db=-10.0)
    x = np.concatenate([noise, tone_], axis=1)
    y = dynamics.gate(x, SR, threshold_db=-40, range_db=40, ratio=10, attack_ms=1, hold_ms=20, release_ms=50)
    assert level_db(x[:, : SR]) - level_db(y[:, : SR]) > 30
    assert abs(level_db(x[:, SR:]) - level_db(y[:, SR:])) < 0.5


# ---------------------------------------------------------------- tom
def test_saturacao_gera_harmonicos_e_mix_zero_e_transparente():
    x = sine(1000, db=-3.0)
    assert np.allclose(tone.saturation(x, SR, "tape", 12, 0, 0), x)
    y = tone.saturation(x, SR, "tape", 18, 100, 0)
    spec = np.abs(np.fft.rfft(y[0, SR // 4:]))
    freqs = np.fft.rfftfreq(y.shape[1] - SR // 4, 1 / SR)
    fund = spec[np.argmin(np.abs(freqs - 1000))]
    third = spec[np.argmin(np.abs(freqs - 3000))]
    assert third / fund > 0.01
    assert y.shape == x.shape


def test_soft_clip_teto():
    y = tone.soft_clip(sine(100, db=0) * 3, SR, ceiling_db=-0.3, input_gain_db=0)
    assert float(np.max(np.abs(y))) <= 10 ** (-0.3 / 20) + 1e-6


def test_normalize_lufs():
    x = sine(1000, db=-20.0, seconds=3.0)
    y = tone.normalize(x, SR, "lufs", -14.0)
    assert abs(analysis.loudness(y, SR) - -14.0) < 0.2


# ---------------------------------------------------------------- espaço
def test_stereo_width_zero_vira_mono():
    x = np.stack([sine(300, ch=1)[0], sine(500, ch=1)[0]])
    y = space.stereo_width(x, SR, 0, 0)
    assert np.allclose(y[0], y[1])


def test_delay_repeticao_no_tempo_certo():
    x = np.zeros((1, SR), dtype=np.float32)
    x[0, 0] = 1.0
    y = space.delay(x, SR, time_ms=100, feedback=0, lowpass_hz=20000, mix=50)
    d = int(0.1 * SR)
    assert abs(y[0, 0] - 0.5) < 1e-6
    assert np.argmax(np.abs(y[0, 10:])) + 10 in range(d - 2, d + 3)


def test_reverb_preserva_duracao():
    x = sine(500, seconds=0.5)
    y = space.reverb(x, SR, room_size=60, damping=50, width=100, predelay_ms=20, mix=30)
    assert y.shape == x.shape and np.all(np.isfinite(y))


# ---------------------------------------------------------------- cadeia
CHAIN = {
    "schema_version": 1,
    "chain": [
        {"type": "highpass", "params": {"frequency_hz": 80, "slope_db_oct": "12"}},
        {"type": "eq_peak", "label": "Mais presença", "params": {"frequency_hz": 3000, "gain_db": {"value": 4}, "q": 1}},
        {"type": "compressor", "params": {"threshold_db": {"value": -24}, "ratio": {"value": 4}}},
        {"type": "saturation", "params": {"mode": "tape", "drive_db": {"value": 6}, "mix": {"value": 50}}},
        {"type": "reverb", "params": {"mix": {"value": 12}}},
        {"type": "limiter", "params": {"ceiling_db": -1}},
    ],
}


def test_interpolacao_de_intensidade_espelha_contrato():
    p = resolve_params("compressor", {"ratio": {"value": 5}, "threshold_db": -10}, 50)
    assert p["ratio"] == pytest.approx(3.0)  # neutral padrão 1
    assert p["threshold_db"] == -10  # número puro = fixo
    assert p["attack_ms"] == 10  # default do módulo
    assert resolve_params("eq_peak", {"gain_db": {"value": 8, "neutral": 2}}, 25)["gain_db"] == pytest.approx(3.5)


def test_cadeia_completa_deterministica():
    x = sine(220, db=-12, seconds=2.0) + sine(3000, db=-18, seconds=2.0)
    a = run_chain(x, SR, CHAIN, 75)
    b = run_chain(x, SR, CHAIN, 75)
    assert np.array_equal(a, b)
    assert a.shape == x.shape
    assert float(np.max(np.abs(a))) <= 10 ** (-1 / 20) + 1e-6


def test_intensidade_maior_processa_mais():
    x = sine(3000, db=-30, seconds=1.0)
    chain = {"schema_version": 1, "chain": [{"type": "eq_peak", "params": {"frequency_hz": 3000, "gain_db": {"value": 8}, "q": 1}}]}
    levels = [level_db(run_chain(x, SR, chain, i)) for i in (25, 50, 75, 100)]
    assert levels == sorted(levels)
    assert levels[-1] - levels[0] == pytest.approx(6.0, abs=0.1)


@pytest.mark.parametrize("bad", [
    {"schema_version": 1, "chain": [{"type": "vst", "params": {}}]},
    {"schema_version": 1, "chain": [{"type": "gain", "params": {"gain_db": 100}}]},
    {"schema_version": 2, "chain": []},
])
def test_cadeia_invalida_rejeitada(bad):
    with pytest.raises(ChainError):
        run_chain(sine(100), SR, bad, 50)


def test_bypass_ignora_modulo():
    x = sine(1000)
    chain = {"schema_version": 1, "chain": [{"type": "gain", "bypass": True, "params": {"gain_db": 12}}]}
    assert np.array_equal(run_chain(x, SR, chain, 100), x)
