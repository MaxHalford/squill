<script setup>
import InfiniteCanvas from '../components/InfiniteCanvas.vue'
import SqlBox from '../components/SqlBox.vue'
import { ref } from 'vue'

const sqlBoxes = ref([
  { id: 1, x: 100, y: 100, width: 500, height: 300 },
  { id: 2, x: 650, y: 100, width: 500, height: 300 },
  { id: 3, x: 100, y: 450, width: 500, height: 300 }
])

const addSqlBox = () => {
  const newBox = {
    id: Date.now(),
    x: 100 + Math.random() * 200,
    y: 100 + Math.random() * 200,
    width: 500,
    height: 300
  }
  sqlBoxes.value.push(newBox)
}
</script>

<template>
  <div class="page">
    <div class="controls">
      <button @click="addSqlBox" class="add-button">+ Add SQL Box</button>
      <div class="instructions">
        <span>Shift + Drag to pan</span>
        <span>Scroll to zoom</span>
      </div>
    </div>

    <InfiniteCanvas>
      <SqlBox
        v-for="box in sqlBoxes"
        :key="box.id"
        :initial-x="box.x"
        :initial-y="box.y"
        :initial-width="box.width"
        :initial-height="box.height"
      />
    </InfiniteCanvas>
  </div>
</template>

<style scoped>
.page {
  position: relative;
  width: 100%;
  height: 100vh;
}

.controls {
  position: fixed;
  top: 20px;
  left: 20px;
  z-index: 1000;
  display: flex;
  gap: 20px;
  align-items: center;
}

.add-button {
  background: #42b883;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(66, 184, 131, 0.3);
  transition: all 0.2s;
}

.add-button:hover {
  background: #35a372;
  box-shadow: 0 4px 12px rgba(66, 184, 131, 0.4);
}

.add-button:active {
  transform: translateY(1px);
}

.instructions {
  display: flex;
  gap: 15px;
  background: rgba(255, 255, 255, 0.9);
  padding: 8px 16px;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.instructions span {
  font-size: 12px;
  color: #666;
  font-family: monospace;
}
</style>
