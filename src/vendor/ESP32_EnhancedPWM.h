/**
* Copied from (adaptions for latest Arduino framework were necessary): https://github.com/CastilloDelSol/ESP32_EnhancedPWM
 */


/****************************************************************************************************************************
  ESP32_EnhancedPWM.h
  For ESP32, ESP32_S2, ESP32_S3, ESP32_C3 boards with ESP32 core v2.0.0+
  Written by Tim Sonennburg, inspired by Khoi Hoang

  Built by Tim Sonnenburg https://github.com/CastilloDelSol/ESP32_EnhancedPWM
  Licensed under MIT license

  Current Version: 1.0.0

  +---------+----------------+------------+------------------+
  | Version | Modified By    | Date       | Comments         |
  +---------+----------------+------------+------------------+
  | 1.0.0   | Tim Sonnenburg | 02/06/2026 | Initial release  |
  +---------+----------------+------------+------------------+

*****************************************************************************************************************************/

#ifndef ESP32_ENHANCED_PWM_H
#define ESP32_ENHANCED_PWM_H

#include <Arduino.h>
#include <driver/ledc.h>

/**
 * @brief A wrapper class for the ESP32 LEDC PWM timer.
 *
 * This class extends the standard LEDC functionality by allowing for extended
 * frequency support (including frequencies below 1 Hz) and fractional frequency
 * adjustments using an enhanced manual divider calculation. It encapsulates both
 * timer and channel configurations, making it easier to initialize and control PWM
 * outputs on the ESP32.
 */
class ESP32_EnhancedPWM
{
private:
    ledc_timer_config_t _timerCfg;     // LEDC timer configuration structure.
    ledc_channel_config_t _channelCfg; // LEDC channel configuration structure.
    uint32_t _maxDuty;                 // Maximum duty cycle value based on resolution.
    uint8_t _boardPin;                 // Board-specific GPIO pin number used for PWM.
    float _exactFrequency;             // Computed (exact) PWM frequency.

public:
    /**
     * @brief Constructs a new ESP32_PWM object.
     *
     * The constructor initializes internal variables and configuration structures.
     */
    ESP32_EnhancedPWM() : _timerCfg{}, _channelCfg{}, _maxDuty(0), _boardPin(UINT8_MAX), _exactFrequency(-1.0f) {}

    /**
     * @brief Initializes and configures the LEDC PWM channel and timer.
     *
     * This function sets up the PWM channel and timer with the specified pin, channel,
     * frequency, resolution, inversion, and clock source. It also calculates the fixed-point
     * divider (with integer and fractional components) necessary for the desired PWM frequency.
     *
     * @note Available clock sources:
     *  - **LEDC_USE_APB_CLK**: Uses the APB clock (typically 80 MHz), offering good resolution for most PWM applications.
     *  - **LEDC_USE_XTAL_CLK**: Uses the external crystal oscillator (typically 40 MHz), if available on your board.
     *  - **LEDC_USE_REF_TICK**: Uses the reference tick clock (1 MHz), which is ideal for generating very low frequencies.
     *  - **LEDC_USE_RTC8M_CLK**: Uses the RTC 8 MHz clock, which may be suitable for certain low-power or specific timing applications.
     *
     * @param pin           The GPIO pin number to output PWM.
     * @param channel       The LEDC channel to use (0 to SOC_LEDC_CHANNEL_NUM - 1).
     * @param frequency     The desired PWM frequency in Hz.
     * @param resolution    The PWM resolution in bits (default is 8).
     * @param isInverted    If true, the PWM output is inverted.
     * @param clk           The LEDC clock source configuration (default is LEDC_USE_APB_CLK).
     *
     * @return true if initialization is successful; false otherwise.
     */
    bool begin(const uint8_t pin, const uint8_t channel, const float frequency, const uint8_t resolution = 8, const bool isInverted = false, const ledc_clk_cfg_t clk = LEDC_USE_APB_CLK)
    {
        ledc_channel_t constrainedChannel = (ledc_channel_t)constrain(channel, 0, SOC_LEDC_CHANNEL_NUM - 1);
        ledc_timer_bit_t constrainedResolution = (ledc_timer_bit_t)constrain(resolution, 1, SOC_LEDC_TIMER_BIT_WIDTH);

        // Channel config (ledc_channel_config_t)
        _channelCfg.channel = constrainedChannel;
        _channelCfg.speed_mode = (ledc_mode_t)(constrainedChannel / 8);
        _channelCfg.timer_sel = (ledc_timer_t)((constrainedChannel / 2) % 4);
        _channelCfg.intr_type = LEDC_INTR_DISABLE;
        _channelCfg.gpio_num = digitalPinToGPIONumber(pin); // Use actual GPIO number
        _channelCfg.flags.output_invert = isInverted;

        // Timer config (ledc_timer_config_t)
        _timerCfg.speed_mode = _channelCfg.speed_mode;
        _timerCfg.timer_num = _channelCfg.timer_sel;
        _timerCfg.duty_resolution = constrainedResolution;
        _timerCfg.freq_hz = (uint32_t)frequency;
        _timerCfg.clk_cfg = clk;

        _maxDuty = (1UL << _timerCfg.duty_resolution) - 1;
        _boardPin = pin;

        // Call the config functions
        ledc_timer_config(&_timerCfg);
        ledc_channel_config(&_channelCfg);

        uint32_t A, B;
        uint32_t clk_src_freq = get_clk_source_frequency(clk);
        calculate_ledc_timer_divider(clk_src_freq, frequency, constrainedResolution, A, B);

        // Integer Part A must be greater than 1, otherwise resolution is too big
        if (A < 1) { return false; }

        _exactFrequency = get_ledc_real_frequency(clk_src_freq, A, B, (uint32_t)_timerCfg.duty_resolution);
        uint32_t divider = extract_fixed_point_divider(A, B);

        // Refine Divider (to establish low frequencies)
        ledc_timer_set(_channelCfg.speed_mode, _channelCfg.timer_sel, divider, _timerCfg.duty_resolution, (ledc_clk_src_t)_timerCfg.clk_cfg);

        return true;
    }

    /**
     * @brief Sets the PWM duty cycle value.
     *
     * The duty value is constrained to the maximum allowable value based on the configured resolution.
     * After updating the duty, the hardware is updated.
     *
     * @param dutyValue The desired duty cycle value (0 to maxDuty).
     */
    void setDuty(uint32_t dutyValue)
    {
        _channelCfg.duty = constrain(dutyValue, 0, _maxDuty);
        ledc_set_duty(_channelCfg.speed_mode, _channelCfg.channel, _channelCfg.duty);
        ledc_update_duty(_channelCfg.speed_mode, _channelCfg.channel);
    }

    /**
     * @brief Sets the PWM duty cycle value and resets the timer
     *
     * The duty value is constrained to the maximum allowable value based on the configured resolution.
     * After updating the duty, the hardware is updated and the timer is reset.
     *
     * @param dutyValue The desired duty cycle value (0 to maxDuty).
     */
    void setDutyAndResetTimer(uint32_t dutyValue)
    {
        setDuty(dutyValue);
        ledc_timer_rst(_channelCfg.speed_mode, _channelCfg.timer_sel);
    }

    /**
     * @brief Sets the PWM duty cycle using a normalized value.
     *
     * The normalized value (ranging from 0.0 to 1.0) is converted into the equivalent duty cycle
     * integer based on the maximum duty value.
     *
     * @param dutyNormalized The normalized duty cycle value (0.0 to 1.0).
     */
    void setDutyNormalized(float dutyNormalized)
    {
        uint32_t dutyInt = (uint32_t)roundf(dutyNormalized * _maxDuty);
        setDuty(dutyInt);
    }

    /**
     * @brief Retrieves the PWM duty resolution in bits.
     *
     * @return The duty resolution (number of bits) configured for the PWM timer.
     */
    uint8_t getResolution() const
    {
        return _timerCfg.duty_resolution;
    }

    /**
     * @brief Retrieves the current PWM frequency from the hardware configuration.
     *
     * @return The PWM frequency in Hz.
     */
    uint32_t getFrequency() const
    {
        return ledc_get_freq(_channelCfg.speed_mode, _timerCfg.timer_num);
    }

    /**
     * @brief Retrieves the computed (exact) PWM frequency from the divider calculation.
     *
     * This may include fractional frequency adjustments that are not visible in the hardware.
     *
     * @return The computed PWM frequency as a float (in Hz).
     */
    float getExactFrequency() const
    {
        return _exactFrequency;
    }

    /**
     * @brief Retrieves the current PWM duty cycle value.
     *
     * @return The duty cycle value as set in the hardware configuration.
     */
    uint32_t getDuty() const
    {
        return _channelCfg.duty;
    }

    /**
     * @brief Retrieves the maximum possible duty cycle value based on the configured resolution.
     *
     * @return The maximum duty cycle value.
     */
    uint32_t getMaxDuty() const
    {
        return _maxDuty;
    }

    /**
     * @brief Retrieves the board-specific GPIO pin used for PWM output.
     *
     * @return The board pin number.
     */
    uint8_t getBoardPin() const
    {
        return _boardPin;
    }

    /**
     * @brief Calculates the LEDC divider parameters for a desired PWM frequency.
     *
     * The PWM output frequency is given by:
     *
     *      f_out = f_src / (divider * 2^(duty_res))
     *
     * where the divider is represented as a fixed-point value:
     *
     *      divider = A + (B/256).
     *
     * @param f_src     The source clock frequency in Hz.
     * @param f_out     The desired PWM output frequency in Hz.
     * @param duty_res  The duty resolution (in bits).
     * @param A         Reference to the variable where the integer part of the divider will be stored.
     * @param B         Reference to the variable where the fractional part of the divider will be stored.
     */
    void calculate_ledc_timer_divider(uint32_t f_src, float f_out, uint8_t duty_res, uint32_t &A, uint32_t &B)
    {
        float divider_target = (float)f_src / (f_out * (1UL << duty_res));

        // The divider must be at least 1.
        divider_target = max(divider_target, 1.0f);

        // Get the integer part, A.
        uint32_t A_temp = (uint32_t)divider_target;

        // Compute the fractional part.
        float frac = divider_target - A_temp;

        // Multiply the fractional part by 256 and round to the nearest integer.
        uint32_t B_temp = (uint32_t)(frac * 256.0f + 0.5f);

        // If rounding pushed the fraction to 1.0, adjust A and reset B.
        if (B_temp >= 256)
        {
            A_temp++;
            B_temp = 0;
        }

        // Ensure A does not exceed 1023 (the maximum allowed value).
        if (A_temp > 1023)
        {
            A_temp = 1023;
            B_temp = 255; // Set fraction to maximum if A is at limit.
        }

        // Assign.
        A = A_temp;
        B = B_temp;
    }

    /**
     * @brief Combines integer and fractional components into a fixed-point divider.
     *
     * The fixed-point divider is stored as a 32-bit unsigned integer with the following layout:
     *   - The integer part `A` (typically occupying the upper 10 bits) is shifted left by 8 bits.
     *   - The fractional part `B` (stored in the lower 8 bits, with each increment representing 1/256)
     *     is masked with 0xFF to ensure it uses only 8 bits.
     *
     * The fixed-point divider is computed as:
     *
     *      fixed_point_divider = (A << 8) | (B & 0xFF)
     *
     * @param A The integer component of the divider.
     * @param B The fractional component of the divider.
     *
     * @return The combined fixed-point divider as a 32-bit unsigned integer.
     */
    uint32_t extract_fixed_point_divider(uint32_t A, uint32_t B)
    {
        return (A << 8) | (B & 0xFF);
    }

    /**
     * @brief Converts a fixed-point divider into its effective floating-point representation.
     *
     * This function interprets a fixed-point number represented by two parts:
     * - The integer part `A` (typically stored in the upper 10 bits).
     * - The fractional part `B` (typically stored in the lower 8 bits),
     *   where each increment represents 1/256.
     *
     * It computes the effective divider as:
     *
     *      effective_divider = A + (B / 256.0f)
     *
     * @param A The integer component of the fixed-point divider.
     * @param B The fractional component of the fixed-point divider.
     *
     * @return The effective divider as a floating-point value.
     */
    float extract_effective_divider(uint32_t A, uint32_t B)
    {
        return A + (B / 256.0f);
    }

    /**
     * @brief Computes the actual (or "real") PWM frequency using the fixed-point divider.
     *
     * The LEDC PWM frequency is determined by:
     *
     *      f_out = f_src / ( (A + B/256) * 2^(duty_res) )
     *
     * where the divider is stored in a 32-bit variable with:
     *      - A in the upper 10 bits (integer part)
     *      - B in the lower 8 bits (fractional part)
     *
     * @param f_src     The source clock frequency (in Hz).
     * @param A         The integer component of the divider.
     * @param B         The fractional component of the divider.
     * @param duty_res  The duty resolution (in bits).
     *
     * @return The computed PWM frequency (in Hz).
     */
    float get_ledc_real_frequency(uint32_t f_src, uint32_t A, uint32_t B, uint32_t duty_res)
    {
        float effective_divider = extract_effective_divider(A, B);

        return f_src / (effective_divider * (1UL << duty_res));
    }

private:
    /**
     * @brief Retrieves the source clock frequency based on the LEDC clock configuration.
     *
     * @param clk_cfg The clock configuration used by the LEDC timer.
     *
     * @return The source clock frequency in Hz.
     */
    uint32_t get_clk_source_frequency(ledc_clk_cfg_t clk_cfg)
    {
        switch (clk_cfg)
        {
        case LEDC_USE_APB_CLK:
            return APB_CLK_FREQ;
        case LEDC_AUTO_CLK:
            return APB_CLK_FREQ;
#if SOC_LEDC_SUPPORT_XTAL_CLOCK
        case LEDC_USE_XTAL_CLK:
            return XTAL_CLK_FREQ;
#endif
        default:
            return APB_CLK_FREQ;
        }
    }
};

#endif // ESP32_ENHANCED_PWM_H
