import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

import { colors, gradients } from '@/theme/tokens';

interface RecordButtonProps {
  recording: boolean;
  disabled?: boolean;
  busy?: boolean;
  level?: number;
  onPress: () => void;
}

const SIZE = 168;

export function RecordButton({ recording, disabled, busy, level = 0, onPress }: RecordButtonProps) {
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (recording) {
      const loop = Animated.loop(
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1600,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      );
      loop.start();
      return () => {
        loop.stop();
        pulse.setValue(0);
      };
    }
    pulse.setValue(0);
    return undefined;
  }, [recording, pulse]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  return (
    <View style={styles.container}>
      {recording ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            { transform: [{ scale: ringScale }], opacity: ringOpacity, borderColor: colors.record },
          ]}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={recording ? 'Parar gravacao' : 'Iniciar gravacao'}
        disabled={disabled || busy}
        onPress={onPress}
        style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
      >
        <LinearGradient
          colors={recording ? gradients.record : gradients.accent}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={[styles.levelHalo, { opacity: 0.15 + level * 0.45 }]} />
          <Ionicons name={recording ? 'stop' : 'mic'} size={recording ? 58 : 66} color="#FFFFFF" />
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: SIZE + 80, height: SIZE + 80, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 2,
  },
  pressable: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  pressed: { transform: [{ scale: 0.96 }] },
  gradient: {
    flex: 1,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelHalo: {
    position: 'absolute',
    width: SIZE - 22,
    height: SIZE - 22,
    borderRadius: (SIZE - 22) / 2,
    backgroundColor: '#FFFFFF',
  },
});
