package ca.jacklai.lifeos

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import ca.jacklai.lifeos.core.CompanionRepository
import ca.jacklai.lifeos.core.CompanionState
import ca.jacklai.lifeos.core.FeedHttpClient
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class TodayState(val content: CompanionState = CompanionState(), val refreshing: Boolean = true)

class TodayViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = CompanionRepository(FeedHttpClient(), AtomicSnapshotStore(File(application.filesDir, "demo-snapshot.json")))
    private val mutable = MutableStateFlow(TodayState())
    val state = mutable.asStateFlow()

    init {
        viewModelScope.launch {
            val saved = withContext(Dispatchers.IO) { repository.open() }
            mutable.value = TodayState(saved, true)
            val fresh = withContext(Dispatchers.IO) { repository.refresh() }
            mutable.value = TodayState(fresh, false)
        }
    }
    fun refresh() {
        if (mutable.value.refreshing) return
        mutable.value = mutable.value.copy(refreshing = true)
        viewModelScope.launch {
            val content = withContext(Dispatchers.IO) { repository.refresh() }
            mutable.value = TodayState(content, false)
        }
    }
}
